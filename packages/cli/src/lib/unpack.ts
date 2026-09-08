import * as fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { applyConfigDefaults, SspWidgetConfig } from './config';
import { WidgetMetadataJson } from './metadata';
import { nextAction } from './output';
import { CONFIG_FILE_NAME, DEFAULT_WIDGET_VERSION, ZIP_SIDECAR_ENTRY_NAME } from './package-identity';
import { extractPreludeTag, PRELUDE_PREFIX } from './prelude';
import { ValidationIssue, validateConfig } from './validate';

export interface UnpackOptions {
    zipPath: string;
    outDir?: string;
    force?: boolean;
    withBundles?: boolean;
}

export interface UnpackResult {
    configPath: string;
    writtenFiles: string[];
    issues: ValidationIssue[];
    nextAction: string;
}

/** `unzipSync` decompresses fully into memory (T-02-02) -- refuse before reading or writing. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

interface PlannedWrite {
    targetPath: string;
    bytes: Uint8Array;
}

/**
 * The zip-slip guard (T-02-01). The archive contract is flat, so a name with
 * ANY path structure -- a separator, a bare `..`, a Windows drive prefix --
 * is either malformed or hostile. There is no legitimate flat entry this
 * rejects.
 */
function isSafeFlatName(name: string): boolean {
    if (!name) {
        return false;
    }
    if (name.includes('/') || name.includes('\\')) {
        return false;
    }
    if (name === '.' || name === '..') {
        return false;
    }
    if (/^[a-zA-Z]:/.test(name)) {
        return false;
    }
    return path.basename(name) === name;
}

function assertSafeEntryName(name: string): void {
    if (!isSafeFlatName(name)) {
        throw new Error(
            `Refusing to unpack: entry name "${name}" is not a safe flat filename -- it contains a path separator, a parent-directory segment, or a drive prefix (zip-slip guard, T-02-01).`
        );
    }
}

/** Second, independent gate: the resolved target must stay inside outDir even if the name check above is ever weakened. */
function assertInsideOutDir(targetPath: string, outDir: string): void {
    const resolvedOutDir = path.resolve(outDir);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget !== resolvedOutDir && !resolvedTarget.startsWith(resolvedOutDir + path.sep)) {
        throw new Error(`Refusing to write outside the output directory: ${resolvedTarget}`);
    }
}

/**
 * `fileFullName` -> version, by stripping the `<tagName>-` prefix and the
 * `-full.js` suffix. Falls back to `DEFAULT_WIDGET_VERSION` rather than
 * throwing when the name does not match the expected shape.
 */
function parseVersionFromFileName(fileFullName: string | undefined, tagName: string): string {
    if (!fileFullName) {
        return DEFAULT_WIDGET_VERSION;
    }
    const prefix = `${tagName}-`;
    const suffix = '-full.js';
    if (!fileFullName.startsWith(prefix) || !fileFullName.endsWith(suffix)) {
        return DEFAULT_WIDGET_VERSION;
    }
    const version = fileFullName.slice(prefix.length, fileFullName.length - suffix.length);
    return version || DEFAULT_WIDGET_VERSION;
}

/**
 * `extractPreludeTag` (prelude.ts) covers only the tag; a synthesized config
 * also needs the prelude's own `config.defaultUrl`. Deliberately local to
 * this module rather than added to `prelude.ts`'s exported contract, which
 * plan 02-01/02-02 already consume as-is.
 */
function extractPreludeDefaultUrl(bundleBytes: Uint8Array): string | undefined {
    const newlineIndex = bundleBytes.indexOf(0x0a);
    const headBytes = newlineIndex === -1 ? bundleBytes : bundleBytes.subarray(0, newlineIndex);
    const firstLine = Buffer.from(headBytes).toString('utf8');
    if (!firstLine.startsWith(PRELUDE_PREFIX)) {
        return undefined;
    }

    const jsonText = firstLine.slice(PRELUDE_PREFIX.length).replace(/;$/, '');
    try {
        const parsed = JSON.parse(jsonText) as { config?: { defaultUrl?: unknown } };
        return typeof parsed.config?.defaultUrl === 'string' ? parsed.config.defaultUrl : undefined;
    } catch {
        return undefined;
    }
}

/**
 * ZIP back to an editable `portal-widget.json` (D-06, PACK-03). Handles both
 * archives this tool produced (sidecar present, byte-identical recovery) and
 * a foreign, Portal-exported archive (no sidecar -- synthesized from
 * `widget-metadata.json` and, where present, the bundle's own prelude).
 * `unpack` is the one command in this package that writes attacker-
 * influenced bytes to a real filesystem path, so every safety check below
 * runs before any write.
 */
export async function unpackWidget(options: UnpackOptions): Promise<UnpackResult> {
    const zipPath = path.resolve(options.zipPath);
    const outDir = options.outDir ? path.resolve(options.outDir) : path.dirname(zipPath);
    const force = options.force ?? false;
    const withBundles = options.withBundles ?? false;

    const stat = await fs.stat(zipPath);
    if (stat.size > MAX_ARCHIVE_BYTES) {
        throw new Error(
            `Refusing to read a ${(stat.size / 1024 / 1024).toFixed(1)} MB archive -- over the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB cap this command will read.`
        );
    }

    const zipBytes = new Uint8Array(await fs.readFile(zipPath));

    let unzipped: Record<string, Uint8Array>;
    try {
        unzipped = unzipSync(zipBytes);
    } catch (error) {
        throw new Error(`Could not open the archive: ${(error as Error).message}`);
    }

    const entryNames = Object.keys(unzipped);
    const totalUncompressed = entryNames.reduce((sum, name) => sum + unzipped[name].length, 0);
    if (totalUncompressed > MAX_ARCHIVE_BYTES) {
        throw new Error(
            `Refusing to unpack an archive that expands to over ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB uncompressed -- decompression-bomb guard (T-02-02).`
        );
    }

    // Screen every entry name before any write, regardless of whether that
    // entry ends up used -- a hostile name elsewhere in the archive must not
    // be allowed to slip through just because this run does not need it.
    for (const name of entryNames) {
        assertSafeEntryName(name);
    }

    const metadataBytes = unzipped['widget-metadata.json'];
    if (!metadataBytes) {
        // Same message the Portal's own reader throws (widget-package.service.ts) --
        // the two tools agree on what a broken archive is.
        throw new Error('widget-metadata.json missing');
    }
    const metadata = JSON.parse(strFromU8(metadataBytes)) as WidgetMetadataJson;

    const sidecarBytes = unzipped[ZIP_SIDECAR_ENTRY_NAME];
    const logoEntryName = unzipped['logo.png'] ? 'logo.png' : undefined;
    const languageEntryNames = entryNames.filter(
        name => name.toLowerCase().endsWith('.json') && name !== 'widget-metadata.json'
    );

    const configPath = path.join(outDir, CONFIG_FILE_NAME);

    let config: SspWidgetConfig;
    let configBytesToWrite: Uint8Array;

    if (sidecarBytes) {
        // Verbatim matters (D-06): the sidecar is the durable source of
        // truth, so reformatting it on the way out would defeat the point.
        configBytesToWrite = sidecarBytes;
        config = applyConfigDefaults(JSON.parse(strFromU8(sidecarBytes)) as Partial<SspWidgetConfig>);
    } else {
        const version = parseVersionFromFileName(metadata.fileFullName, metadata.tagName);
        const fullBundleBytes = metadata.fileFullName ? unzipped[metadata.fileFullName] : undefined;
        const tag = fullBundleBytes ? extractPreludeTag(fullBundleBytes) : null;
        const template: SspWidgetConfig['template'] = tag ? 'embed' : 'unknown';
        const defaultUrl = tag && fullBundleBytes ? extractPreludeDefaultUrl(fullBundleBytes) : undefined;

        const partial: Partial<SspWidgetConfig> = {
            template,
            tagName: metadata.tagName,
            version,
            name: metadata.name,
            description: metadata.description,
            changes: metadata.changes,
            tags: metadata.tags,
            defaultSize: metadata.defaultSize,
            angularVersion: metadata.angularVersion,
            authenticated: metadata.authenticated,
            dependencies: metadata.dependencies,
            ...(template === 'embed' && defaultUrl ? { embed: { defaultUrl } } : {}),
            ...(logoEntryName ? { logo: `./${logoEntryName}` } : {}),
            ...(languageEntryNames.length ? { languageFiles: languageEntryNames.map(name => `./${name}`) } : {})
        };

        config = applyConfigDefaults(partial);
        configBytesToWrite = Buffer.from(`${JSON.stringify(config, null, 4)}\n`, 'utf8');
    }

    const plannedWrites: PlannedWrite[] = [{ targetPath: configPath, bytes: configBytesToWrite }];

    if (logoEntryName) {
        const logoTarget = path.join(outDir, logoEntryName);
        assertInsideOutDir(logoTarget, outDir);
        plannedWrites.push({ targetPath: logoTarget, bytes: unzipped[logoEntryName] });
    }

    for (const name of languageEntryNames) {
        const target = path.join(outDir, name);
        assertInsideOutDir(target, outDir);
        plannedWrites.push({ targetPath: target, bytes: unzipped[name] });
    }

    if (withBundles) {
        for (const fileName of [metadata.fileFullName, metadata.fileLightName]) {
            if (!fileName || !unzipped[fileName]) {
                continue;
            }
            assertSafeEntryName(fileName);
            const target = path.join(outDir, fileName);
            assertInsideOutDir(target, outDir);
            plannedWrites.push({ targetPath: target, bytes: unzipped[fileName] });
        }
    }

    if (!force) {
        const clobbered = plannedWrites.find(write => fsSync.existsSync(write.targetPath));
        if (clobbered) {
            throw new Error(
                `Refusing to overwrite existing file: ${clobbered.targetPath}. Re-run with --force to overwrite.`
            );
        }
    }

    await fs.mkdir(outDir, { recursive: true });

    const writtenFiles: string[] = [];
    for (const write of plannedWrites) {
        await fs.writeFile(write.targetPath, write.bytes);
        writtenFiles.push(write.targetPath);
    }

    const issues = validateConfig(config, outDir);
    if (config.template === 'unknown') {
        issues.push({
            severity: 'warning',
            field: 'template',
            code: 'preludeMissing',
            message:
                'This archive carries no portal-widget.json.txt sidecar and its bundle carries no prelude tag -- it likely predates this tool or was built elsewhere. Its tagName cannot be checked against its metadata, and re-packing it with template "embed" will not work until the tag/prelude coupling is established by hand.'
        });
    }

    return {
        configPath,
        writtenFiles,
        issues,
        nextAction: nextAction('unpack', { configPath })
    };
}
