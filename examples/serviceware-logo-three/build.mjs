/**
 * Builds the widget bundles and the dev harness with esbuild.
 *
 *   node build.mjs                      one-off build (minified, light CSS mode)
 *   node build.mjs --css-mode shadow    shadow DOM instead of light-mode scoping
 *   node build.mjs --watch --serve      rebuild on change and serve the Portal mock on http://localhost:4201
 *
 * Output: the two bundle paths named in portal-widget.json (full and light are identical for a
 * non-Angular widget) and dev/harness.js. Nothing here depends on the Portal monorepo.
 */
import * as esbuild from 'esbuild';
import { Buffer } from 'node:buffer';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const watch = args.includes('--watch') || serve;
const cssMode = optionValue('--css-mode', 'light');
const port = Number(optionValue('--port', '4201'));

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
}

const cssPlugin = {
    name: 'portal-widget-css',
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, loadArgs => {
            const css = readFileSync(loadArgs.path, 'utf8');
            return { contents: cssMode === 'light' ? scopeCss(css) : css, loader: 'text' };
        });
        // The logo SVG is imported as a string and parsed at runtime by three's SVGLoader.
        build.onLoad({ filter: /\.svg$/ }, loadArgs => ({ contents: readFileSync(loadArgs.path, 'utf8'), loader: 'text' }));
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
    banner: { js: `/* ${tag} ${version} | css: ${cssMode} | built with @serviceware/portal-widget-sdk */` },
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

function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
}

/**
 * Mock of `GET {apiUrl}/storage/v1/widgets/{tag}/{version}/translations/{lang}`: requires a bearer
 * token (so a widget that bypasses ctx.fetch fails visibly), falls back from `de-DE` to `de`, and
 * reports the served language in `x-sw-language` like the Portal does.
 */
function serveTranslations(req, res, requestedTag, language) {
    if (requestedTag !== tag) {
        sendJson(res, 404, { error: `Unknown widget "${requestedTag}".` });
        return;
    }
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(language)) {
        sendJson(res, 400, { error: `Invalid language "${language}".` });
        return;
    }
    if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
        sendJson(res, 401, { error: 'Missing bearer token. Call the Portal API through ctx.fetch / ctx.loadTranslations.' });
        return;
    }
    const candidates = [language, language.split('-')[0]].map(code => join(here, 'translations', `${code}.json`));
    const file = candidates.find(existsSync);
    if (!file) {
        sendJson(res, 404, { error: `No translations for "${language}".` });
        return;
    }
    sendJson(res, 200, JSON.parse(readFileSync(file, 'utf8')), { 'x-sw-language': basename(file, '.json') });
}

function startServer() {
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        res.setHeader('Cache-Control', 'no-store');

        const translations = url.pathname.match(/^\/mock-api\/storage\/v1\/widgets\/([^/]+)\/([^/]+)\/translations\/([^/]+)$/);
        if (translations) {
            serveTranslations(req, res, decodeURIComponent(translations[1]), decodeURIComponent(translations[3]));
            return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
            sendFile(res, join(here, 'dev', 'index.html'));
            return;
        }
        if (url.pathname === '/harness.js') {
            sendFile(res, harnessBundle);
            return;
        }
        // Dev-only: the harness's "save frame" button posts a PNG of the widget canvas here.
        if (url.pathname === '/dev/frame' && req.method === 'POST') {
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const file = join(here, 'dev', 'last-frame.png');
                writeFileSync(file, Buffer.concat(chunks));
                console.log(`[${tag}] frame saved to ${file}`);
                sendJson(res, 200, { saved: file });
            });
            return;
        }
        if (url.pathname.startsWith('/bundles/')) {
            sendFile(res, join(dirname(fullBundle), basename(url.pathname)));
            return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
    });

    server.listen(port, () => {
        console.log(`\nPortal harness: http://localhost:${port}/`);
        console.log(`Bundle:         http://localhost:${port}/bundles/${basename(fullBundle)}`);
        console.log('To test in a real Portal, override the bundle response in Chrome DevTools (docs/contract.md section 10).\n');
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
