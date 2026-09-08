const fs = require('fs');
const path = require('path');
const concatWithSourceMaps = require('concat-with-sourcemaps');
const args = process.argv.slice(2);

const createStylesJsString = require('../build-styles');
// Sourcemaps are intentionally suppressed for widget bundles to keep them lean;
// the previous `args.includes('noSourceMap') || true` was dead-coded to the same
// effect, but readers kept assuming the flag was wired.
const withoutSourceMap = true;
const widgetFolder = path.join(__dirname, './../../../../../dist/' + args[0]);

// Read widget name from widget-metadata.json (same source rename-widget.js uses)
const metadataPath = path.join(__dirname, './../../../../../' + args[0], 'widget-metadata.json');
const widgetMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const widgetName = process.env.SSP_WIDGET_SCOPE_NAME || widgetMeta.name;

function collectSourceFiles(directory) {
    if (!fs.existsSync(directory)) return [];

    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(entryPath);
        return entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name) && !/\.(?:spec|test)\.[cm]?[jt]s$/.test(entry.name)
            ? [entryPath]
            : [];
    });
}

function hasCodeBlueCb3Preset(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return /provideCodeBlue\s*\([\s\S]*?kind\s*:\s*['"]preset['"][\s\S]*?preset\s*:\s*['"]cb3['"]/m.test(content);
}

const widgetSourcePath = path.join(__dirname, './../../../../../' + args[0], 'src');
const isCodeBlue3Widget = collectSourceFiles(widgetSourcePath).some(hasCodeBlueCb3Preset);

// Scope every selector in styles.css to [widgetName] — mirrors the
// cssScopeAttribute rewrite @codeblue/prime does for its own CSS at runtime.
const postcss = require('postcss');
const scopePlugin = require('../postcss-widget-scope-plugin');
const stylesCssPath = widgetFolder + '/styles.css';
const rawCss = fs.existsSync(stylesCssPath) ? fs.readFileSync(stylesCssPath, 'utf8') : '';
let processedCss = isCodeBlue3Widget
    ? ''
    : postcss([scopePlugin({ widgetName })]).process(rawCss, { from: undefined }).css;
const PORTAL_LAYER_ORDER = 'codeblue-legacy, codeblue3, portal-base, primeng, portal-overrides, widgets, app-overrides';
const PORTAL_WIDGET_TOKEN_PATTERN = /--(?:cb3|p)-[a-z0-9-]+/gi;

function collectPortalWidgetTokensFromFiles(fileNames) {
    const tokens = new Set();

    for (const fileName of fileNames) {
        const filePath = `${widgetFolder}/${fileName}`;
        if (!fs.existsSync(filePath)) continue;

        const source = fs.readFileSync(filePath, 'utf8');
        for (const match of source.matchAll(PORTAL_WIDGET_TOKEN_PATTERN)) {
            tokens.add(match[0].toLowerCase());
        }
    }

    return [...tokens].sort();
}

function createPortalTokenShield(tokens) {
    if (!tokens.length) return '';

    const declarations = tokens.map(token => `${token}: initial;`).join(' ');
    return `\n@layer widgets { [${widgetName}] { ${declarations} } }`;
}

const iconFontFamilyMatch = /@font-face\s*{[^}]*font-family:\s*['"]?([^;'"}]+)['"]?/i.exec(processedCss);
if (!isCodeBlue3Widget) {
    processedCss = `@layer ${PORTAL_LAYER_ORDER};\n${processedCss}`;
}
if (!isCodeBlue3Widget && iconFontFamilyMatch && !/material\s+icons/i.test(iconFontFamilyMatch[1])) {
    const iconFontFamily = iconFontFamilyMatch[1].trim();
    processedCss = `${processedCss}\n[${widgetName}] [class^='cbi-'], [${widgetName}] [class*=' cbi-'], [${widgetName}] [class^='cbi-']::before, [${widgetName}] [class^='cbi-']::after, [${widgetName}] [class*=' cbi-']::before, [${widgetName}] [class*=' cbi-']::after { font-family: '${iconFontFamily}' !important; -webkit-mask: none !important; mask: none !important; -webkit-mask-image: none !important; mask-image: none !important; background: none !important; } [${widgetName}] .p-button-icon[class^='cbi-'], [${widgetName}] .p-button-icon[class*=' cbi-'], [${widgetName}] .e-btn [class^='cbi-'], [${widgetName}] .e-btn [class*=' cbi-'] { display: inline-flex !important; align-items: center !important; justify-content: center !important; vertical-align: middle !important; } [${widgetName}] .p-button-icon[class^='cbi-']::before, [${widgetName}] .p-button-icon[class*=' cbi-']::before, [${widgetName}] .e-btn [class^='cbi-']::before, [${widgetName}] .e-btn [class*=' cbi-']::before { display: block !important; }`;
}
if (!isCodeBlue3Widget) {
    processedCss = `${processedCss}\n@layer primeng { [${widgetName}] .p-floatlabel { display: block !important; position: relative !important; margin-top: 5px !important; } [${widgetName}] .p-floatlabel > label { position: absolute !important; pointer-events: none !important; top: 0 !important; transform: translateY(-50%) !important; transition-property: all !important; transition-timing-function: ease !important; line-height: 1 !important; inset-inline-start: .75rem !important; background: #fff !important; padding: 0 .25rem !important; } }`;
}

// Angular 22+ always emits common.js (shared webpack chunk). Inline it before
// main.js so its push([[chunkId], ...]) registers in installedChunks before
// main calls r.e(chunkId); without this the runtime fetches it from storage (404).
const hasCommonChunk = fs.existsSync(`${widgetFolder}/common.js`);
const filesToBundle = ['runtime', 'polyfills', ...(hasCommonChunk ? ['common'] : []), 'main'];
if (!isCodeBlue3Widget) {
    const portalWidgetTokens = collectPortalWidgetTokensFromFiles([
        ...filesToBundle.map(file => `${file}.js`),
        'styles.css'
    ]);
    processedCss = `${processedCss}${createPortalTokenShield(portalWidgetTokens)}`;
    console.error(`elements-build-script.js: portalWidgetTokensShielded=${portalWidgetTokens.length}`);
}
const cssBuffer = createStylesJsString(processedCss);
const stylesMapPath = widgetFolder + '/styles.css.map';
const cssSourceMap = !withoutSourceMap && fs.existsSync(stylesMapPath) ? fs.readFileSync(stylesMapPath, 'utf8') : null;

const getMap = function (file) {
    return withoutSourceMap ? null : fs.readFileSync(`${widgetFolder}/${file}.js.map`, 'utf8');
};

const concat = new concatWithSourceMaps(true, widgetFolder + '.js', '\n');
concat.add('styles.js', cssBuffer, cssSourceMap);
filesToBundle.forEach(file => {
    concat.add(`${file}.js`, fs.readFileSync(`${widgetFolder}/${file}.js`), getMap(file));
});

const concatenatedContent = concat.content;
const sourceMapForContent = concat.sourceMap;

fs.writeFileSync(widgetFolder + '/main.js', concatenatedContent);
fs.writeFileSync(widgetFolder + '/main.js.map', sourceMapForContent);
