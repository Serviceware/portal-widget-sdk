/**
 * Two-stage build: Astro renders src/pages to static HTML, esbuild folds that HTML and CSS into the
 * widget bundle together with the small runtime in src/widget/main.ts.
 *
 *   node build.mjs                      one-off build (minified, light CSS mode)
 *   node build.mjs --css-mode shadow    shadow DOM instead of light-mode scoping
 *   node build.mjs --watch --serve      rebuild on change and serve the Portal mock on http://localhost:4203
 *
 * Output: the two bundle paths named in portal-widget.json (full and light are identical for a
 * non-Angular widget) and dev/harness.js. dist-astro/ is Astro's intermediate output.
 */
import { build as astroBuild } from 'astro';
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch as watchFiles } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const watch = args.includes('--watch') || serve;
const cssMode = optionValue('--css-mode', 'light');
const port = Number(optionValue('--port', '4203'));

function optionValue(flag, fallback) {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

if (cssMode !== 'light' && cssMode !== 'shadow') {
    console.error(`--css-mode must be "light" or "shadow", got "${cssMode}".`);
    process.exit(1);
}

process.env.ASTRO_TELEMETRY_DISABLED = '1';

const config = JSON.parse(readFileSync(join(here, 'portal-widget.json'), 'utf8'));
const tag = config.tagName;
const version = config.version;
const fullBundle = join(here, config.custom.fullBundlePath);
const lightBundle = join(here, config.custom.lightBundlePath);
const harnessBundle = join(here, 'dev', 'harness.js');
const astroOutDir = join(here, 'dist-astro');

/**
 * Light-mode CSS isolation (docs/css-isolation.md section 3, steps 4 and 5) for a flat stylesheet:
 * every selector is prefixed with `[<tag>]`, `:host` becomes `[<tag>]`, and everything is wrapped
 * in `@layer widgets`. Nested at-rules are rejected so nothing can slip out unscoped.
 */
function scopeCss(css) {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@[a-z-]+/i.test(stripped)) {
        throw new Error('Astro CSS contains an at-rule; the light-mode scoper in build.mjs only handles flat stylesheets. Keep <style> blocks flat.');
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

/** Filled by collectAstroOutput(); read by the virtual-module plugin on every (re)build. */
let astroOutput = { pages: null, css: '' };

/**
 * Rules for the custom element itself, which no Astro page can style: the runtime adds `asc-host`
 * to the element, and the SDK mirrors the Portal's `hidden` input onto it as an attribute.
 */
const HOST_CSS = '.asc-host { display: block; height: 100%; }\n.asc-host[hidden] { display: none; }';

/** "Astro v7.3.2", from the installed package (Astro no longer writes a generator meta tag). */
function astroGenerator() {
    try {
        let dir = dirname(createRequire(import.meta.url).resolve('astro'));
        while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir) {
            dir = dirname(dir);
        }
        const { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        return name === 'astro' && version ? `Astro v${version}` : 'Astro';
    } catch {
        return 'Astro';
    }
}

/**
 * Lifts what the widget needs out of one rendered page: the <body> children and every inlined <style>.
 * Refuses output the widget could not carry: external stylesheets and client scripts.
 */
function extractPage(file, cssParts) {
    const html = readFileSync(file, 'utf8');
    if (/<link[^>]+rel=["']?stylesheet/i.test(html)) {
        throw new Error(`${basename(file)} links an external stylesheet; set build.inlineStylesheets to "always" in astro.config.mjs.`);
    }
    for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        cssParts.add(match[1].trim());
    }
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!body) {
        throw new Error(`${basename(file)} has no <body>; the Card layout must render a full document.`);
    }
    if (/<script[\s>]/i.test(body[1])) {
        throw new Error(`${basename(file)} contains a <script>; this widget is static, put runtime behaviour into src/widget/main.ts.`);
    }
    return body[1].trim();
}

function collectAstroOutput() {
    const languages = readdirSync(astroOutDir).filter(name => name !== '_astro' && statSync(join(astroOutDir, name)).isDirectory());
    if (languages.length === 0) {
        throw new Error(`Astro produced no language folders in ${astroOutDir}.`);
    }
    const cssParts = new Set();
    const pages = { generator: astroGenerator(), languages, widget: {}, settings: {} };
    for (const lang of languages) {
        pages.widget[lang] = extractPage(join(astroOutDir, lang, 'index.html'), cssParts);
        pages.settings[lang] = extractPage(join(astroOutDir, lang, 'settings', 'index.html'), cssParts);
    }
    const css = [HOST_CSS, ...cssParts].join('\n');
    astroOutput = { pages, css: cssMode === 'light' ? scopeCss(css) : css };
    console.log(`[${tag}] Astro rendered ${languages.join(', ')} (${pages.generator}, ${(css.length / 1024).toFixed(1)} kB css)`);
}

async function runAstro() {
    await astroBuild({ root: here, logLevel: 'warn' });
    collectAstroOutput();
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

const astroPlugin = {
    name: 'astro-output',
    setup(build) {
        build.onResolve({ filter: /^virtual:astro-/ }, resolveArgs => ({ path: resolveArgs.path, namespace: 'astro-output' }));
        build.onLoad({ filter: /.*/, namespace: 'astro-output' }, loadArgs => {
            if (!astroOutput.pages) {
                throw new Error('Astro output not collected before bundling.');
            }
            if (loadArgs.path === 'virtual:astro-pages') {
                return { contents: JSON.stringify(astroOutput.pages), loader: 'json' };
            }
            if (loadArgs.path === 'virtual:astro-styles') {
                return { contents: astroOutput.css, loader: 'text' };
            }
            throw new Error(`Unknown virtual module ${loadArgs.path}.`);
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
    entryPoints: [join(here, 'src', 'widget', 'main.ts')],
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
    banner: { js: `/* ${tag} ${version} | css: ${cssMode} | Astro + @serviceware/portal-widget-sdk */` },
    plugins: [astroPlugin, finishPlugin],
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
        // This widget never calls the Portal API; the mock only exists so the harness can set an apiUrl.
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

/**
 * esbuild's own watcher cannot see Astro sources (they only reach it through the virtual modules),
 * so watch mode re-runs Astro and then asks the esbuild context to rebuild.
 */
function watchAstroSources(rebuild) {
    let timer;
    let building = false;
    let queued = false;
    const trigger = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            if (building) {
                queued = true;
                return;
            }
            building = true;
            try {
                await runAstro();
                await rebuild();
            } catch (error) {
                console.error(error instanceof Error ? error.message : error);
            } finally {
                building = false;
                if (queued) {
                    queued = false;
                    trigger();
                }
            }
        }, 200);
    };
    watchFiles(join(here, 'src'), { recursive: true }, trigger);
    watchFiles(join(here, 'astro.config.mjs'), trigger);
}

async function main() {
    mkdirSync(dirname(fullBundle), { recursive: true });
    await runAstro();

    if (!watch) {
        await esbuild.build(widgetOptions);
        await esbuild.build(harnessOptions);
        return;
    }

    const widgetContext = await esbuild.context(widgetOptions);
    const harnessContext = await esbuild.context(harnessOptions);
    await widgetContext.rebuild();
    await harnessContext.watch();
    watchAstroSources(() => widgetContext.rebuild());
    if (serve) {
        startServer();
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
