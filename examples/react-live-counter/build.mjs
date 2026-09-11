/**
 * Builds the widget bundles and the dev harness with esbuild.
 *
 *   node build.mjs                      one-off build (minified, light CSS mode)
 *   node build.mjs --css-mode shadow    shadow DOM instead of light-mode scoping
 *   node build.mjs --watch --serve      rebuild on change and serve the Portal mock on http://localhost:4202
 *
 * React needs nothing special: esbuild compiles the JSX (`jsx: react-jsx` in tsconfig.json) and bundles
 * `react` and `react-dom` into the classic IIFE script. `process.env.NODE_ENV` is pinned to
 * "production" so React ships its production build.
 */
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const watch = args.includes('--watch') || serve;
const cssMode = optionValue('--css-mode', 'light');
const port = Number(optionValue('--port', '4202'));

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
    // React's development build would ship its warnings and a much larger bundle.
    if (text.includes('react.development.js') || text.includes('react-dom.development.js')) {
        throw new Error(`${basename(file)} contains React's development build; process.env.NODE_ENV was not pinned.`);
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
    __CSS_MODE__: JSON.stringify(cssMode),
    'process.env.NODE_ENV': JSON.stringify('production')
};

/** @type {import('esbuild').BuildOptions} */
const widgetOptions = {
    entryPoints: [join(here, 'src', 'main.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    // Always minified: pack picks up whatever is in bundles/, so a dev run must never leave a different artefact behind.
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    outfile: fullBundle,
    define,
    banner: { js: `/* ${tag} ${version} | css: ${cssMode} | React + @serviceware/portal-widget-sdk */` },
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
        // This widget ships no translation files; the mock API only exists so ctx.fetch has an apiUrl.
        if (url.pathname.startsWith('/mock-api/')) {
            res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Not mocked.' }));
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
