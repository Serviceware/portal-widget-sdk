/**
 * Builds the six test widgets (modes.mjs) from src/main.ts: one bundle per mode, with __AUTH_MODE__ and the tag
 * injected, plus a portal-widget.json per widget, all under widgets/<tag>/ (generated, gitignored).
 *
 *   node build.mjs
 *
 * Light-mode CSS isolation (docs/css-isolation.md section 3): every selector is scoped to [<tag>] inside
 * `@layer widgets`. A bundle that contains a test credential is refused: widgets never carry credentials.
 */
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, TEST_CREDENTIALS } from './modes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';

function scopeCss(css, tag) {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@[a-z-]+/i.test(stripped)) {
        throw new Error('styles.css: at-rules are not supported by the light-mode scoper in build.mjs; keep the stylesheet flat.');
    }
    const scoped = stripped.replace(/([^{}]+)\{/g, (_, selectorList) => {
        const selectors = selectorList
            .split(',')
            .map(selector => selector.trim())
            .filter(Boolean)
            .map(selector => (selector.startsWith(':host') ? `[${tag}]${selector.slice(':host'.length)}` : `[${tag}] ${selector}`));
        return `${selectors.join(', ')} {`;
    });
    return `@layer widgets {\n${scoped.trim()}\n}`;
}

function widgetConfig({ tag, mode, title }) {
    return {
        template: 'custom',
        tagName: tag,
        version: VERSION,
        name: [
            { language: 'en', value: `Auth test: ${title}` },
            { language: 'de', value: `Auth-Test: ${title}` }
        ],
        description: [
            {
                language: 'en',
                value: `<p>Test widget: calls a Service Connection with security mode ${mode} through the Portal proxy and shows whether the test API accepted the credential.</p>`
            },
            {
                language: 'de',
                value: `<p>Test-Widget: ruft eine Service Connection mit Sicherheitsmodus ${mode} über den Portal-Proxy auf und zeigt, ob die Test-API die Zugangsdaten akzeptiert hat.</p>`
            }
        ],
        changes: [{ language: 'en', value: '<p>Initial version.</p>' }],
        tags: ['Portal', 'Test', 'Service-Connection'],
        defaultSize: { columns: 4, rows: 4 },
        angularVersion: 0,
        authenticated: true,
        dependencies: [{ name: 'Portal', dependency: '>=3.0.0' }],
        custom: {
            fullBundlePath: `bundles/${tag}-${VERSION}-full.js`,
            lightBundlePath: `bundles/${tag}-${VERSION}-light.js`
        }
    };
}

function verifyBundle(file, tag) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('customElements.define(') || (!text.includes(`"${tag}"`) && !text.includes(`'${tag}'`))) {
        throw new Error(`${file}: must call customElements.define() with the tag "${tag}" as a string literal.`);
    }
    for (const [name, value] of Object.entries(TEST_CREDENTIALS)) {
        if (value.length > 6 && text.includes(value)) {
            throw new Error(`${file} contains the test credential "${name}"; credentials belong in the Service Connection.`);
        }
    }
}

const source = join(here, 'src', 'main.ts');
const css = readFileSync(join(here, 'src', 'styles.css'), 'utf8');

for (const widget of MODES) {
    const dir = join(here, 'widgets', widget.tag);
    const config = widgetConfig(widget);
    const fullBundle = join(dir, config.custom.fullBundlePath);
    mkdirSync(dirname(fullBundle), { recursive: true });

    await esbuild.build({
        entryPoints: [source],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'eof',
        outfile: fullBundle,
        define: { __WIDGET_TAG__: JSON.stringify(widget.tag), __AUTH_MODE__: JSON.stringify(widget.mode) },
        banner: { js: `/* ${widget.tag} ${VERSION} | auth mode test | @serviceware-oss/portal-widget-sdk */` },
        plugins: [
            {
                name: 'scoped-css',
                setup(build) {
                    build.onLoad({ filter: /\.css$/ }, () => ({ contents: scopeCss(css, widget.tag), loader: 'text' }));
                }
            }
        ],
        logLevel: 'warning'
    });

    verifyBundle(fullBundle, widget.tag);
    copyFileSync(fullBundle, join(dir, config.custom.lightBundlePath));
    writeFileSync(join(dir, 'portal-widget.json'), `${JSON.stringify(config, null, 4)}\n`);
    console.log(`[${widget.tag}] ${widget.mode}: bundles + portal-widget.json written`);
}
