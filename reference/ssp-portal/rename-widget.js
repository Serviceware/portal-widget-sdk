const fs = require('fs');
const path = require('path');
const { argv } = require('process');
const postcss = require('postcss');
const createStylesJsString = require('../libs/utils/src/shared/build-styles');
const scopePlugin = require('../libs/utils/src/shared/postcss-widget-scope-plugin');

const widgetName = argv[2];
if (!widgetName) {
    console.error('Please provide the widget name as the first argument.');
    process.exit(1);
}

const widgetPath = path.join(__dirname, '../widgets', widgetName);
const widgetMetadataPath = path.join(widgetPath, 'widget-metadata.json');

if (!fs.existsSync(widgetMetadataPath)) {
    console.error(`Widget metadata for ${widgetName} not found. Please add widget-metadata.json to the widget folder.`);
    process.exit(1);
}

let metadata;
try {
    metadata = JSON.parse(fs.readFileSync(widgetMetadataPath, 'utf8'));
} catch (err) {
    console.error(`Error parsing widget-metadata.json for ${widgetName}:`, err.message);
    process.exit(1);
}

const baseName = metadata?.widgetVersion?.name;
const version = metadata?.widgetVersion?.number;

if (!baseName || !version) {
    console.error(`widget-metadata.json for ${widgetName} must include widgetVersion.name and widgetVersion.number`);
    process.exit(1);
}

const widgetFolder = path.join('dist', 'widgets', widgetName);
const buildType = argv.includes('light') ? 'light' : 'full';
const newFileName = `${baseName}-${version}-${buildType}.js`;
const mainJsPath = path.join(widgetFolder, 'main.js');

// CB3 widgets (provideCodeBlue preset 'cb3') isolate their CSS at runtime via
// cssScopeAttribute and must NOT get the scoped global CSS + legacy icon-font
// reset injected below — its `mask: none !important` in @layer codeblue-legacy
// outranks every later layer and blanks all mask-based cbi- icons.
// Detection mirrors libs/utils/src/shared/widgets/elements-build-script.js.
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

const isCodeBlue3Widget = collectSourceFiles(path.join(widgetPath, 'src')).some(hasCodeBlueCb3Preset);

if (buildType === 'light') {
    const stylesCssPath = path.join(widgetFolder, 'styles.css');
    const mainJs = fs.readFileSync(mainJsPath, 'utf8');

    if (fs.existsSync(stylesCssPath) && !mainJs.includes('ssp-widget-css-isolation') && !isCodeBlue3Widget) {
        const scopeName = process.env.SSP_WIDGET_SCOPE_NAME || metadata.name;
        const rawCss = fs.readFileSync(stylesCssPath, 'utf8');
        let processedCss = postcss([scopePlugin({ widgetName: scopeName })]).process(rawCss, { from: undefined }).css;
        const iconFontFamilyMatch = /@font-face\s*{[^}]*font-family:\s*['"]?([^;'"}]+)['"]?/i.exec(processedCss);

        if (iconFontFamilyMatch) {
            const iconFontFamily = iconFontFamilyMatch[1].trim();
            processedCss = `@layer codeblue-legacy { [${scopeName}] [class^='cbi-'], [${scopeName}] [class*=' cbi-'] { font-family: '${iconFontFamily}' !important; -webkit-mask: none !important; mask: none !important; -webkit-mask-image: none !important; mask-image: none !important; background: none !important; } }\n${processedCss}`;
        }

        fs.writeFileSync(mainJsPath, `${createStylesJsString(processedCss)}\n${mainJs}`);
    }
}

fs.rename(mainJsPath, path.join(widgetFolder, newFileName), err => {
    if (err) {
        console.error('Error renaming widget:', err.message);
        process.exit(1);
    }
    console.log(`Widget renamed to: ${newFileName}`);
});
