/**
 * Local test API behind the six test connections. Each mode has its own path; a request is accepted only with
 * the credential the Portal proxy must add for that mode (test values from modes.mjs). Answers report header
 * and query *names*, never values, so nothing secret is echoed back to the widget.
 *
 *   node upstream.mjs                    http://127.0.0.1:4310 (PORT / HOST to change)
 *
 *   /none/...      no credential may arrive
 *   /bearer/...    Authorization: Bearer <TEST_BEARER_TOKEN>
 *   /custom/...    header x-api-key: <TEST_API_KEY> and query appid=<TEST_APP_ID>
 *   /basic/...     Authorization: Basic base64(<TEST_BASIC_USER>:<TEST_BASIC_PASSWORD>)
 *   /oauth/token   POST, client credentials grant (client_secret_post or Basic); issues a short-lived token
 *   /oauth/...     Authorization: Bearer <a token issued by /oauth/token>
 *   /forward/...   Authorization: Bearer <the user's Portal token> (decoded, not verified: a test API)
 *
 * In every mode but forward, a Portal token (a JWT) arriving here means the proxy failed to drop the caller's
 * Authorization header: reported as portalTokenReachedUpstream.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import process from 'node:process';
import { MODES, TEST_CREDENTIALS as T } from './modes.mjs';

const port = Number(process.env.PORT || 4310);
const host = process.env.HOST || '127.0.0.1';
const TOKEN_LIFETIME_SECONDS = 300;

/** access token -> expiry (ms). */
const issuedTokens = new Map();

function bearer(headers) {
    const match = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? '');
    return match ? match[1].trim() : undefined;
}

function decodeJwt(token) {
    const parts = (token ?? '').split('.');
    if (parts.length !== 3) {
        return undefined;
    }
    try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return header && typeof header.alg === 'string' ? payload : undefined;
    } catch {
        return undefined;
    }
}

function checkMode(segment, headers, query) {
    const token = bearer(headers);
    switch (segment) {
        case 'none':
            return headers.authorization || headers[T.apiKeyHeader]
                ? { accepted: false, reason: 'a credential arrived although the connection has mode None' }
                : { accepted: true, reason: 'no credential arrived, as expected for mode None' };
        case 'bearer':
            return token === T.bearerToken
                ? { accepted: true, reason: 'the expected bearer token arrived' }
                : { accepted: false, reason: token ? 'a bearer token arrived, but not the expected one' : 'no bearer token arrived' };
        case 'custom': {
            const headerOk = headers[T.apiKeyHeader] === T.apiKey;
            const queryOk = query.get(T.queryName) === T.queryValue;
            if (headerOk && queryOk) {
                return { accepted: true, reason: `header ${T.apiKeyHeader} and query parameter ${T.queryName} arrived with the expected values` };
            }
            const missing = [!headerOk && `header ${T.apiKeyHeader}`, !queryOk && `query parameter ${T.queryName}`].filter(Boolean);
            return { accepted: false, reason: `missing or wrong: ${missing.join(', ')}` };
        }
        case 'basic': {
            const expected = `Basic ${Buffer.from(`${T.basicUser}:${T.basicPassword}`).toString('base64')}`;
            return headers.authorization === expected
                ? { accepted: true, reason: 'the expected Basic credentials arrived' }
                : { accepted: false, reason: /^Basic /i.test(headers.authorization ?? '') ? 'Basic credentials arrived, but wrong' : 'no Basic credentials arrived' };
        }
        case 'oauth': {
            const expiry = token ? issuedTokens.get(token) : undefined;
            if (expiry && expiry > Date.now()) {
                return { accepted: true, reason: 'a valid access token issued by /oauth/token arrived (the Portal fetched it with the client credentials grant)' };
            }
            return { accepted: false, reason: token ? 'a bearer token arrived, but it was not issued by /oauth/token or has expired' : 'no access token arrived' };
        }
        case 'forward': {
            const claims = decodeJwt(token);
            if (!claims) {
                return { accepted: false, reason: token ? 'a bearer token arrived, but it is not a JWT' : 'no user token arrived (anonymous visitor?)' };
            }
            const expiresAt = typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : undefined;
            const user = { name: claims.preferred_username ?? claims.name ?? claims.sub, issuer: claims.iss, expiresAt: expiresAt?.toISOString() };
            if (expiresAt && expiresAt.getTime() < Date.now()) {
                return { accepted: false, reason: 'the user token arrived but has expired', user };
            }
            return { accepted: true, reason: `the user's Portal token arrived (user ${user.name ?? 'unknown'})`, user };
        }
        default:
            return undefined;
    }
}

function readBody(req) {
    return new Promise(resolve => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

async function issueToken(req, res) {
    const form = new URLSearchParams(await readBody(req));
    let clientId = form.get('client_id');
    let clientSecret = form.get('client_secret');
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (basic) {
        [clientId, clientSecret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
    }
    if (form.get('grant_type') !== 'client_credentials') {
        return send(res, 400, { error: 'unsupported_grant_type' }, 'token');
    }
    if (clientId !== T.clientId || clientSecret !== T.clientSecret) {
        return send(res, 401, { error: 'invalid_client' }, 'token');
    }
    const accessToken = `oat-${randomBytes(18).toString('base64url')}`;
    issuedTokens.set(accessToken, Date.now() + TOKEN_LIFETIME_SECONDS * 1000);
    send(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS, scope: form.get('scope') ?? '' }, 'token issued');
}

function send(res, status, body, logNote) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
    console.log(`${new Date().toISOString()}  ${status}  ${logNote}`);
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const [segment = ''] = url.pathname.split('/').filter(Boolean);

    if (url.pathname === '/oauth/token' && req.method === 'POST') {
        await issueToken(req, res);
        return;
    }
    const definition = MODES.find(m => m.segment === segment);
    const result = definition && checkMode(segment, req.headers, url.searchParams);
    if (!definition || !result) {
        send(res, 404, { error: `unknown test path; use one of ${MODES.map(m => `/${m.segment}`).join(', ')}` }, `${req.method} ${url.pathname} unknown`);
        return;
    }
    const portalTokenReachedUpstream = segment !== 'forward' && decodeJwt(bearer(req.headers)) !== undefined;
    send(
        res,
        result.accepted ? 200 : 401,
        {
            mode: definition.mode,
            accepted: result.accepted,
            reason: result.reason,
            method: req.method,
            path: url.pathname,
            queryNames: [...new Set(url.searchParams.keys())].sort(),
            headerNames: Object.keys(req.headers).sort(),
            portalTokenReachedUpstream,
            ...(result.user ? { user: result.user } : {})
        },
        `${req.method} ${url.pathname} ${definition.mode}: ${result.accepted ? 'accepted' : 'refused'} (${result.reason})`
    );
});

server.listen(port, host, () => {
    console.log(`Test API on http://${host}:${port}. From the Portal containers: http://host.docker.internal:${port}/<mode>`);
    console.log('Connection base URLs and test credentials: see README.md.\n');
});
