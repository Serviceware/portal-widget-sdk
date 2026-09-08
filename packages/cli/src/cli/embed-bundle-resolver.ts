import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACKAGE_ROOT } from '../package-root';

const BUNDLE_BASE_NAME = 'embed-widget-1.0.0';

export interface EmbedBundles {
    full: Uint8Array;
    light: Uint8Array;
}

/**
 * Resolves the checked-in embed bundle directory for a given Portal Angular
 * major version: `<package root>/assets/embed/ng<major>/`. The package root
 * is overridable so tests can point at a synthetic tree.
 */
export function getEmbedBundleDir(angularMajor: number, packageRoot = PACKAGE_ROOT): string {
    return path.join(packageRoot, 'assets', 'embed', `ng${angularMajor}`);
}

export function readEmbedBundles(angularMajor: number, packageRoot = PACKAGE_ROOT): EmbedBundles {
    const dir = getEmbedBundleDir(angularMajor, packageRoot);
    const fullPath = path.join(dir, `${BUNDLE_BASE_NAME}-full.js`);
    const lightPath = path.join(dir, `${BUNDLE_BASE_NAME}-light.js`);

    if (!fs.existsSync(fullPath) || !fs.existsSync(lightPath)) {
        throw new Error(
            `Embed bundles not found at ${dir}. This likely means the package was not built correctly.`
        );
    }

    return {
        full: new Uint8Array(fs.readFileSync(fullPath)),
        light: new Uint8Array(fs.readFileSync(lightPath))
    };
}
