/**
 * End-to-end check of all six modes through a real Portal proxy, without the UI. Needs the test API running
 * (`pnpm upstream`) and a Portal 3 with the Service Connection proxy and ServiceConnections:SecretKey.
 *
 *   PORTAL_API_URL=http://localhost:61208 PORTAL_TOKEN=<admin access token> node e2e.mjs
 *
 *   UPSTREAM_URL   the test API as the Portal *server* reaches it (default http://host.docker.internal:4310)
 *
 * Creates the connections `auth-test-<mode>` when missing (they stay, for testing the widgets in the UI),
 * places one temporary widget instance per mode on the first page (any installed widget version: the proxy
 * checks the link and the page, not the widget), calls the proxy as the widget would, and removes the
 * instances again. Exit code 1 when any check fails. Never prints the token.
 */
import process from 'node:process';
import { MODES, TEST_CREDENTIALS as T } from './modes.mjs';

const apiUrl = (process.env.PORTAL_API_URL ?? '').replace(/\/+$/, '');
const token = process.env.PORTAL_TOKEN;
const upstream = (process.env.UPSTREAM_URL ?? 'http://host.docker.internal:4310').replace(/\/+$/, '');
if (!apiUrl || !token) {
    console.error('Set PORTAL_API_URL and PORTAL_TOKEN (an admin access token).');
    process.exit(2);
}

const SECURITY = {
    None: { mode: 0 },
    BearerToken: { mode: 1, headers: [{ key: 'Authorization', value: `Bearer ${T.bearerToken}` }] },
    Custom: { mode: 2, headers: [{ key: T.apiKeyHeader, value: T.apiKey }], queryParameters: [{ key: T.queryName, value: T.queryValue }] },
    Basic: { mode: 3, basic: { username: T.basicUser, password: T.basicPassword } },
    OAuth2ClientCredentials: {
        mode: 4,
        oAuth2: { tokenUrl: `${upstream}/oauth/token`, clientId: T.clientId, clientSecret: T.clientSecret, scope: 'widgets.read' }
    },
    ForwardUserToken: { mode: 5 }
};

const auth = { authorization: `Bearer ${token}` };

async function api(method, path, body) {
    const response = await fetch(`${apiUrl}/${path}`, {
        method,
        headers: { ...auth, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = text;
    }
    if (!response.ok) {
        throw new Error(`${method} ${path} -> HTTP ${response.status} ${text.slice(0, 300)}`);
    }
    return json;
}

const proxy = (connectionId, headers) =>
    fetch(`${apiUrl}/api/v1/proxy/${connectionId}/check?probe=e2e`, { headers: { accept: 'application/json', ...headers } });

const results = [];
function record(name, pass, detail) {
    results.push(pass);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} ${detail}`);
}

const routes = await api('GET', 'api/v1/admin/Routes');
const page = routes[0];
const { widgets } = await api('GET', 'api/v2/admin/widgets');
const versionId = widgets.map(w => w.latestVersion?.id).find(Boolean);
if (!page || !versionId) {
    throw new Error('Needs at least one page and one installed widget.');
}

const existing = await api('GET', 'api/v2/admin/serviceconnections');
const connections = {};
for (const { mode, segment } of MODES) {
    const name = `auth-test-${segment}`;
    connections[mode] =
        existing.find(c => c.name === name)?.id ??
        (await api('POST', 'api/v2/admin/serviceconnections?overridedefault=false', {
            module: 'portal',
            name,
            url: `${upstream}/${segment}`,
            isDefault: false,
            exposeCredentials: false,
            security: { allowAnonymous: false, ...SECURITY[mode] }
        }));
}

const instances = [];
async function placeWidget(connectionIds) {
    const placed = await api('POST', 'api/v1/admin/routewidgets', {
        routeId: page.id,
        widgetversionId: versionId,
        customConfig: {},
        serviceConnectionsId: connectionIds
    });
    instances.push(placed.id);
    return placed.id;
}

try {
    for (const { mode } of MODES) {
        const instance = await placeWidget([connections[mode]]);
        const response = await proxy(connections[mode], { ...auth, 'x-portal-widget-instance': instance });
        const text = await response.text();
        let verdict;
        try {
            verdict = JSON.parse(text);
        } catch {
            verdict = undefined;
        }
        const pass =
            response.ok && verdict?.mode === mode && verdict.accepted === true && (mode === 'ForwardUserToken' || !verdict.portalTokenReachedUpstream);
        record(`mode ${mode}`, pass, verdict ? verdict.reason : `HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    // Secret values only: header names, the Basic username and the OAuth client id are shown on purpose.
    const secrets = [T.bearerToken, T.apiKey, T.queryValue, T.basicPassword, T.clientSecret];
    const adminJson = JSON.stringify(await api('GET', 'api/v2/admin/serviceconnections'));
    record('admin read masks every secret', secrets.every(s => !adminJson.includes(s)), 'GET api/v2/admin/serviceconnections');

    const linked = await placeWidget([connections.Custom]);
    const config = JSON.stringify(await api('GET', `api/v1/config/routewidgets/${linked}`));
    record('widget config carries no secret', secrets.every(s => !config.includes(s)), 'exposeCredentials off');

    const unlinked = await placeWidget([]);
    const unlinkedStatus = (await proxy(connections.Custom, { ...auth, 'x-portal-widget-instance': unlinked })).status;
    record('unlinked instance is refused', unlinkedStatus === 404, `HTTP ${unlinkedStatus} (expect 404)`);
    const anonymousStatus = (await proxy(connections.Custom, { 'x-portal-widget-instance': linked })).status;
    record('anonymous caller is refused', anonymousStatus === 404, `HTTP ${anonymousStatus} (expect 404, allowAnonymous off)`);
    const noHeaderStatus = (await proxy(connections.Custom, auth)).status;
    record('missing instance header is refused', noHeaderStatus === 400, `HTTP ${noHeaderStatus} (expect 400)`);
} finally {
    for (const id of instances) {
        await api('DELETE', `api/v1/admin/routewidgets/${id}`).catch(error => console.error(`cleanup: ${error.message}`));
    }
}

const failed = results.filter(pass => !pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
