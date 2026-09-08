#!/usr/bin/env node
/**
 * Regenerates assets/embed/ng<major>/ from a fresh build of the Portal's
 * `widgets/embed-widget`. Manual maintenance command only -- deliberately
 * not part of `build` or CI: regenerating a ~1.8 MB checked-in binary
 * artifact is a reviewable-diff act, not a build step.
 *
 * The embed widget's Angular sources live in the SSP_Portal monorepo (branch
 * feature/private-widget-toolkit, `widgets/embed-widget/`), because they
 * build through that repo's Nx pipeline and shared widget build scripts. This
 * script therefore needs a local SSP_Portal checkout, given as
 * `SSP_PORTAL_DIR` or `--portal <dir>`:
 *
 *   SSP_PORTAL_DIR=C:/GitSources/SSP_Portal pnpm refresh-embed-assets [22]
 *
 * Routes around a repo-wide, pre-existing build characteristic of SSP_Portal
 * (not fixed here): `build:embed:full` and `build:embed:light` both write to
 * the same `dist/widgets/embed-widget/` outputPath, and Angular's browser
 * builder deletes that directory before each build (`deleteOutputPath: true`
 * by default), so a naive `full && light` chain always loses the full
 * bundle's renamed output the instant the light build starts. Copying the
 * full bundle out before the light build starts needs no change over there.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PRELUDE_PREFIX = 'globalThis.__SSP_WIDGET_DEF__=';
const DEFAULT_ANGULAR_MAJOR = 22;

// Must match BUNDLE_BASE_NAME in ../src/cli/embed-bundle-resolver.ts, which
// is a fixed string -- pack() has no way to discover a version-derived
// filename at runtime. If widget-metadata.json's version ever moves, the
// resolver's constant must move with it, or the packer stops finding the
// checked-in assets.
const EXPECTED_BUNDLE_BASE_NAME = 'embed-widget-1.0.0';

function parseArgs(argv) {
    let portalDir = process.env.SSP_PORTAL_DIR;
    let angularMajor = DEFAULT_ANGULAR_MAJOR;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--portal') {
            portalDir = argv[++i];
        } else {
            angularMajor = Number(argv[i]);
        }
    }
    if (!portalDir) {
        throw new Error('Set SSP_PORTAL_DIR or pass --portal <dir> pointing at a local SSP_Portal checkout.');
    }
    if (!Number.isInteger(angularMajor) || angularMajor <= 0) {
        throw new Error(`Invalid Angular major "${angularMajor}" -- expected a positive integer.`);
    }
    return { portalDir: path.resolve(portalDir), angularMajor };
}

function readWidgetVersion(metadataPath) {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const { name, number } = metadata.widgetVersion ?? {};
    if (!name || !number) {
        throw new Error(`widget-metadata.json is missing widgetVersion.name/number at ${metadataPath}`);
    }
    return { baseName: name, version: number };
}

function run(command, args, cwd) {
    console.log(`> ${command} ${args.join(' ')}`);
    execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function copyBuiltBundle(distPath, assetPath, label) {
    if (!existsSync(distPath)) {
        throw new Error(`Expected build output not found at ${distPath} after building the ${label} bundle.`);
    }
    copyFileSync(distPath, assetPath);
}

function assertPristine(filePath) {
    const stats = statSync(filePath);
    if (stats.size === 0) {
        throw new Error(`${filePath} is empty after the build -- refusing to ship it.`);
    }

    const head = readFileSync(filePath, 'utf8').slice(0, PRELUDE_PREFIX.length);
    if (head === PRELUDE_PREFIX) {
        throw new Error(
            `${filePath} already carries a prelude -- the shipped asset must be pristine so pack() can prepend its own.`
        );
    }

    return stats.size;
}

function main() {
    const { portalDir, angularMajor } = parseArgs(process.argv.slice(2));
    const widgetDistDir = path.join(portalDir, 'dist', 'widgets', 'embed-widget');
    const widgetMetadataPath = path.join(portalDir, 'widgets', 'embed-widget', 'widget-metadata.json');
    if (!existsSync(widgetMetadataPath)) {
        throw new Error(
            `${widgetMetadataPath} not found -- is ${portalDir} an SSP_Portal checkout on a branch that carries widgets/embed-widget?`
        );
    }

    const { baseName, version } = readWidgetVersion(widgetMetadataPath);
    const bundleBaseName = `${baseName}-${version}`;
    if (bundleBaseName !== EXPECTED_BUNDLE_BASE_NAME) {
        throw new Error(
            `widget-metadata.json now derives "${bundleBaseName}", but embed-bundle-resolver.ts still expects ` +
                `"${EXPECTED_BUNDLE_BASE_NAME}" -- update BUNDLE_BASE_NAME there too before refreshing assets, ` +
                'or the packer will not find the new files.'
        );
    }

    const assetsDir = path.join(PACKAGE_ROOT, 'assets', 'embed', `ng${angularMajor}`);
    mkdirSync(assetsDir, { recursive: true });

    const fullFileName = `${bundleBaseName}-full.js`;
    const lightFileName = `${bundleBaseName}-light.js`;
    const distFullPath = path.join(widgetDistDir, fullFileName);
    const distLightPath = path.join(widgetDistDir, lightFileName);
    const assetFullPath = path.join(assetsDir, fullFileName);
    const assetLightPath = path.join(assetsDir, lightFileName);

    run('pnpm', ['build:embed:full'], portalDir);
    // Copy the full bundle out IMMEDIATELY -- build:embed:light shares the
    // same outputPath and Angular's builder wipes it before the next build.
    copyBuiltBundle(distFullPath, assetFullPath, 'full');

    run('pnpm', ['build:embed:light'], portalDir);
    copyBuiltBundle(distLightPath, assetLightPath, 'light');

    const fullSize = assertPristine(assetFullPath);
    const lightSize = assertPristine(assetLightPath);

    console.log(`Refreshed assets/embed/ng${angularMajor}/:`);
    console.log(`  ${fullFileName} -- ${fullSize} bytes`);
    console.log(`  ${lightFileName} -- ${lightSize} bytes`);
}

try {
    main();
} catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
}
