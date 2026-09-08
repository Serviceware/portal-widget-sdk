import * as fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readEmbedBundles } from '../cli/embed-bundle-resolver';
import { readConfig, SspWidgetConfig } from './config';
import { buildWidgetMetadata } from './metadata';
import { nextAction } from './output';
import { ZIP_SIDECAR_ENTRY_NAME } from './package-identity';
import { prependPrelude } from './prelude';
import { formatIssues, validateConfig, validateZip } from './validate';

export interface PackOptions {
    configPath: string;
    outDir?: string;
}

export interface PackResult {
    zipPath: string;
    zipBytes: Uint8Array;
    entryNames: string[];
    nextAction: string;
}

interface PackBundles {
    full: Uint8Array;
    light: Uint8Array;
    /** Set only for the custom template -- the resolved full-bundle path, named in the coupling pre-flight's error message. */
    fullBundlePath?: string;
}

const PACKABLE_TEMPLATES: SspWidgetConfig['template'][] = ['embed', 'custom'];

/**
 * Resolves one of `config.custom`'s bundle paths relative to the config
 * file's own directory -- the same treatment `config.logo` and
 * `config.languageFiles` already receive (T-03-06). Rejects an absolute
 * path or one that escapes `configDir` via `..`, mirroring `unpack.ts`'s
 * zip-slip containment shape for this new disk-read path.
 */
function resolveCustomBundlePath(configDir: string, relativePath: string, field: string): string {
    if (path.isAbsolute(relativePath)) {
        throw new Error(`custom.${field} must be a path relative to the config file's directory, got an absolute path: "${relativePath}".`);
    }

    const resolved = path.resolve(configDir, relativePath);
    if (resolved !== configDir && !resolved.startsWith(configDir + path.sep)) {
        throw new Error(`custom.${field} "${relativePath}" resolves outside the project directory (${resolved}).`);
    }

    return resolved;
}

async function readCustomBundles(config: SspWidgetConfig, configDir: string): Promise<PackBundles> {
    if (!config.custom?.fullBundlePath || !config.custom?.lightBundlePath) {
        throw new Error(
            'Cannot pack this config: "custom" must be present with both "fullBundlePath" and "lightBundlePath" for the custom template.'
        );
    }

    const fullPath = resolveCustomBundlePath(configDir, config.custom.fullBundlePath, 'fullBundlePath');
    const lightPath = resolveCustomBundlePath(configDir, config.custom.lightBundlePath, 'lightBundlePath');

    for (const bundlePath of [fullPath, lightPath]) {
        if (!fsSync.existsSync(bundlePath)) {
            throw new Error(`Bundle file not found at ${bundlePath}. Run the widget's own build command (e.g. "npm run build") to produce it.`);
        }
    }

    return {
        full: new Uint8Array(await fs.readFile(fullPath)),
        light: new Uint8Array(await fs.readFile(lightPath)),
        fullBundlePath: fullPath
    };
}

/**
 * Replaces, for a build-time-tagged bundle, the coupling safety the embed
 * path gets from `tagPreludeIssues` (PACK-07): a scaffolded bundle has no
 * prelude to compare against, so the only remaining evidence that the
 * bundle actually registers the declared tag is `customElements.define()`'s
 * first argument, which survives minification as a quoted string literal.
 */
function assertTagRegisteredInBundle(fullBundleBytes: Uint8Array, tagName: string, fullBundlePath: string): void {
    const text = Buffer.from(fullBundleBytes).toString('utf8');
    const quotedSingle = `'${tagName}'`;
    const quotedDouble = `"${tagName}"`;
    if (!text.includes(quotedSingle) && !text.includes(quotedDouble)) {
        throw new Error(
            `Refusing to pack: tagName "${tagName}" does not appear as a quoted string literal in ${fullBundlePath}. ` +
            'The bundle likely registers a different custom element -- the tag in portal-widget.json was probably changed without rebuilding.'
        );
    }
}

/**
 * Config in, ZIP bytes + written file out. Entry order matches the Portal's
 * own packer (D-12): `widget-metadata.json` first, then the full bundle,
 * then the light bundle (D-13: both always emitted), then the optional logo,
 * then the optional language files, then the config sidecar (D-06) last.
 */
export async function packWidget(options: PackOptions): Promise<PackResult> {
    const configPath = path.resolve(options.configPath);
    const config: SspWidgetConfig = readConfig(configPath);

    if (!PACKABLE_TEMPLATES.includes(config.template)) {
        throw new Error(
            `Cannot pack this config: "template" must be one of ${PACKABLE_TEMPLATES.map(item => `"${item}"`).join(' or ')}, got "${config.template}".`
        );
    }

    const configDir = path.dirname(configPath);
    const outDir = options.outDir ? path.resolve(options.outDir) : configDir;

    const configIssues = validateConfig(config, configDir);
    if (configIssues.some(item => item.severity === 'error')) {
        throw new Error(`Refusing to pack an invalid config:\n${formatIssues(configIssues)}`);
    }

    const bundles: PackBundles =
        config.template === 'embed' ? readEmbedBundles(config.angularVersion) : await readCustomBundles(config, configDir);

    if (config.template === 'custom') {
        assertTagRegisteredInBundle(bundles.full, config.tagName, bundles.fullBundlePath as string);
    }

    const metadata = buildWidgetMetadata(config);
    const fullEntryName = metadata.fileFullName as string;
    const lightEntryName = metadata.fileLightName as string;

    const entries: Record<string, Uint8Array> = {
        'widget-metadata.json': strToU8(JSON.stringify(metadata, null, 2)),
        [fullEntryName]: config.template === 'embed' ? prependPrelude(bundles.full, config) : bundles.full,
        [lightEntryName]: config.template === 'embed' ? prependPrelude(bundles.light, config) : bundles.light
    };

    if (config.logo) {
        const logoBytes = await fs.readFile(path.resolve(configDir, config.logo));
        entries['logo.png'] = new Uint8Array(logoBytes);
    }

    if (config.languageFiles?.length) {
        for (const languageFile of config.languageFiles) {
            const languagePath = path.resolve(configDir, languageFile);
            const languageBytes = await fs.readFile(languagePath);
            entries[path.basename(languagePath)] = new Uint8Array(languageBytes);
        }
    }

    const configBytes = await fs.readFile(configPath);
    entries[ZIP_SIDECAR_ENTRY_NAME] = new Uint8Array(configBytes);

    const zipBytes = zipSync(entries, { level: 0 });

    const zipIssues = validateZip(zipBytes);
    if (zipIssues.some(item => item.severity === 'error')) {
        throw new Error(`Refusing to write a ZIP that validate would reject:\n${formatIssues(zipIssues)}`);
    }

    const zipPath = path.join(outDir, `${config.tagName}.zip`);

    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(zipPath, zipBytes);

    return {
        zipPath,
        zipBytes,
        entryNames: Object.keys(entries),
        nextAction: nextAction('pack', { zipPath })
    };
}
