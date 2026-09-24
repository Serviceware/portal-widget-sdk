/**
 * Builds the widget bundles and the dev harness with esbuild.
 *
 *   node build.mjs                      one-off build (minified, light CSS mode)
 *   node build.mjs --css-mode shadow    shadow DOM instead of light-mode scoping
 *   node build.mjs --watch --serve      rebuild on change and serve the Portal mock on http://localhost:4204
 *
 * The dev server also mocks the Portal's Service Connection proxy (`/mock-api/api/v1/proxy/...`) with the
 * same rules as the backend POC: Portal token required, connection must be linked to the widget
 * instance, caller credentials dropped, the connection's API key injected server-side. The key lives
 * only in this Node process (DEMO_API_KEY), never in the page.
 */
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const watch = args.includes('--watch') || serve;
const cssMode = optionValue('--css-mode', 'light');
const port = Number(optionValue('--port', '4204'));

function optionValue(flag, fallback) {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

if (cssMode !== 'light' && cssMode !== 'shadow') {
    console.error(`--css-mode must be "light" or "shadow", got "${cssMode}".`);
    process.exit(1);
}

const config = JSON.parse(readFileSync(join(here, 'portal-widget.json'), 'utf8'));
const tag = config.tagName;
const version = config.version;
const fullBundle = join(here, config.custom.fullBundlePath);
const lightBundle = join(here, config.custom.lightBundlePath);
const harnessBundle = join(here, 'dev', 'harness.js');

/** Must match dev/harness.ts. */
const MOCK = {
    connectionId: '5b0c7c0e-8f3a-4d7e-9d52-2f8f1c1d9a10',
    widgetInstanceId: 'c3a1b0f2-0000-4000-8000-000000000001',
    apiKey: process.env.DEMO_API_KEY || 'demo-key-kept-on-the-server'
};

/**
 * Light-mode CSS isolation (docs/css-isolation.md section 3, steps 4 and 5) for a flat stylesheet:
 * every selector is prefixed with `[<tag>]`, `:host` becomes `[<tag>]`, and everything is wrapped
 * in `@layer widgets`. Nested at-rules are rejected so nothing can slip out unscoped.
 */
function scopeCss(css) {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@[a-z-]+/i.test(stripped)) {
        throw new Error('styles.css: at-rules are not supported by the light-mode scoper in build.mjs; keep the stylesheet flat.');
    }
    const scoped = stripped.replace(/([^{}]+)\{/g, (_, selectorList) => {
        const selectors = selectorList
            .split(',')
            .map(selector => selector.trim())
            .filter(Boolean)
            .map(selector => {
                if (selector === ':host') {
                    return `[${tag}]`;
                }
                if (selector.startsWith(':host')) {
                    return `[${tag}]${selector.slice(':host'.length)}`;
                }
                return `[${tag}] ${selector}`;
            });
        return `${selectors.join(', ')} {`;
    });
    return `@layer widgets {\n${scoped.trim()}\n}`;
}

function verifyBundle(file) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('customElements.define(')) {
        throw new Error(`${basename(file)} does not call customElements.define().`);
    }
    if (!text.includes(`"${tag}"`) && !text.includes(`'${tag}'`)) {
        throw new Error(`${basename(file)} does not contain the tag "${tag}" as a string literal; pack would refuse it.`);
    }
    if (text.includes(MOCK.apiKey)) {
        throw new Error(`${basename(file)} contains the demo API key; it must stay on the server.`);
    }
}

const cssPlugin = {
    name: 'portal-widget-css',
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, loadArgs => {
            const css = readFileSync(loadArgs.path, 'utf8');
            return { contents: cssMode === 'light' ? scopeCss(css) : css, loader: 'text' };
        });
    }
};

const finishPlugin = {
    name: 'portal-widget-finish',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length > 0) {
                return;
            }
            verifyBundle(fullBundle);
            copyFileSync(fullBundle, lightBundle);
            const kb = (statSync(fullBundle).size / 1024).toFixed(1);
            console.log(`[${tag}] ${basename(fullBundle)} + ${basename(lightBundle)} written (${kb} kB each, css: ${cssMode})`);
        });
    }
};

const define = {
    __WIDGET_TAG__: JSON.stringify(tag),
    __WIDGET_VERSION__: JSON.stringify(version),
    __CSS_MODE__: JSON.stringify(cssMode)
};

/** @type {import('esbuild').BuildOptions} */
const widgetOptions = {
    entryPoints: [join(here, 'src', 'main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // Always minified: pack picks up whatever is in bundles/, so a dev run must never leave a different artefact behind.
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    outfile: fullBundle,
    define,
    banner: { js: `/* ${tag} ${version} | css: ${cssMode} | @serviceware/portal-widget-sdk */` },
    plugins: [cssPlugin, finishPlugin],
    logLevel: 'info'
};

/** @type {import('esbuild').BuildOptions} */
const harnessOptions = {
    entryPoints: [join(here, 'dev', 'harness.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: harnessBundle,
    define,
    logLevel: 'info'
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

function sendFile(res, file) {
    if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end(`Not found: ${basename(file)}`);
        return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

/** Stand-in for the third-party API behind the connection. Reports what reached it, never the key itself. */
function mockUpstream(method, path, query, headers) {
    if (headers['x-api-key'] !== MOCK.apiKey) {
        return { status: 401, body: { error: 'Missing or wrong x-api-key.' } };
    }
    return {
        status: 200,
        body: {
            upstream: 'mock third-party API',
            method,
            path,
            query,
            apiKeyAccepted: true,
            portalTokenReachedUpstream: 'authorization' in headers,
            headersReceived: Object.keys(headers).sort()
        }
    };
}

/** Mirrors ServiceConnectionProxyController + ServiceConnectionProxyForwarder in the backend POC. */
function mockProxy(req, res, url, rest) {
    const [connectionId, ...segments] = rest.split('/');
    if (!/^Bearer .+/.test(req.headers.authorization ?? '')) {
        sendJson(res, 401, { title: 'Portal token required.' });
        return;
    }
    const instance = req.headers['x-portal-widget-instance'];
    if (!instance) {
        sendJson(res, 400, { title: 'Header X-Portal-Widget-Instance with the route widget id is required.' });
        return;
    }
    if (connectionId !== MOCK.connectionId || instance !== MOCK.widgetInstanceId) {
        res.writeHead(404);
        res.end();
        return;
    }
    const decoded = segments.map(segment => decodeURIComponent(segment));
    if (decoded.some(segment => segment === '.' || segment === '..' || segment.includes('\\'))) {
        sendJson(res, 400, { title: 'Invalid proxy path.' });
        return;
    }

    // Allowlisted caller headers only; Authorization, Cookie and friends never cross the proxy.
    const forwarded = {};
    for (const name of ['accept', 'accept-language', 'content-type']) {
        if (req.headers[name]) {
            forwarded[name] = req.headers[name];
        }
    }
    forwarded['x-api-key'] = MOCK.apiKey;

    const upstream = mockUpstream(req.method, `/${decoded.join('/')}`, Object.fromEntries(url.searchParams), forwarded);
    res.writeHead(upstream.status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff'
    });
    res.end(JSON.stringify(upstream.body));
}

function startServer() {
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        res.setHeader('Cache-Control', 'no-store');

        if (url.pathname === '/' || url.pathname === '/index.html') {
            sendFile(res, join(here, 'dev', 'index.html'));
            return;
        }
        if (url.pathname === '/harness.js') {
            sendFile(res, harnessBundle);
            return;
        }
        if (url.pathname.startsWith('/bundles/')) {
            sendFile(res, join(dirname(fullBundle), basename(url.pathname)));
            return;
        }
        // What the settings view lists; the Portal masks every header value.
        if (url.pathname === '/mock-api/api/v2/admin/serviceconnections') {
            sendJson(res, 200, [
                {
                    id: MOCK.connectionId,
                    name: 'weather',
                    module: 'portal',
                    url: 'https://api.weather.example/v1',
                    isDefault: false,
                    security: { mode: 2, headers: [{ key: 'x-api-key', value: '********' }] }
                }
            ]);
            return;
        }
        const proxyPrefix = '/mock-api/api/v1/proxy/';
        if (url.pathname.startsWith(proxyPrefix)) {
            mockProxy(req, res, url, url.pathname.slice(proxyPrefix.length));
            return;
        }
        if (url.pathname.startsWith('/mock-api/')) {
            sendJson(res, 404, { error: 'Not mocked.' });
            return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
    });

    server.listen(port, () => {
        console.log(`\nPortal harness: http://localhost:${port}/`);
        console.log(`Mock proxy:     http://localhost:${port}${'/mock-api/api/v1/proxy/'}${MOCK.connectionId}/...`);
        console.log('The demo API key is held by this Node process only (set DEMO_API_KEY to change it).\n');
    });
}

async function main() {
    mkdirSync(dirname(fullBundle), { recursive: true });

    if (!watch) {
        await esbuild.build(widgetOptions);
        await esbuild.build(harnessOptions);
        return;
    }

    const widgetContext = await esbuild.context(widgetOptions);
    const harnessContext = await esbuild.context(harnessOptions);
    await widgetContext.watch();
    await harnessContext.watch();
    if (serve) {
        startServer();
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
