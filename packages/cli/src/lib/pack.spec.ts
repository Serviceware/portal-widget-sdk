import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { unzipSync } from 'fflate';
import { getEmbedBundleDir } from '../cli/embed-bundle-resolver';
import { SspWidgetConfig } from './config';
import { buildWidgetMetadata } from './metadata';
import { packWidget } from './pack';
import { buildPrelude, extractPreludeTag, prependPrelude, PRELUDE_PREFIX } from './prelude';

function baseConfig(overrides: Partial<SspWidgetConfig> = {}): SspWidgetConfig {
    return {
        template: 'embed',
        tagName: 'ssp-status',
        version: '1.0.0',
        name: [{ language: 'en', value: 'Status' }],
        description: [{ language: 'en', value: 'Status' }],
        changes: [{ language: 'en', value: 'Initial version' }],
        tags: [],
        defaultSize: { columns: 4, rows: 3 },
        angularVersion: 22,
        authenticated: false,
        dependencies: [],
        embed: { defaultUrl: 'https://x.test/' },
        ...overrides
    };
}

function baseCustomConfig(overrides: Partial<SspWidgetConfig> = {}): SspWidgetConfig {
    return {
        template: 'custom',
        tagName: 'ssp-custom-widget',
        version: '1.0.0',
        name: [{ language: 'en', value: 'Custom Widget' }],
        description: [{ language: 'en', value: 'Custom Widget' }],
        changes: [{ language: 'en', value: 'Initial version' }],
        tags: [],
        defaultSize: { columns: 4, rows: 3 },
        angularVersion: 22,
        authenticated: false,
        dependencies: [],
        custom: {
            fullBundlePath: './bundles/ssp-custom-widget-1.0.0-full.js',
            lightBundlePath: './bundles/ssp-custom-widget-1.0.0-light.js'
        },
        ...overrides
    };
}

describe('prelude', () => {
    it('builds a single JSON-carrying statement terminated by ; and a newline', () => {
        const config = baseConfig({ tagName: 'ssp-status', embed: { defaultUrl: 'https://x.test/' } });
        const line = buildPrelude(config);

        expect(line.startsWith(PRELUDE_PREFIX)).toBe(true);
        expect(line.endsWith(';\n')).toBe(true);

        const jsonText = line.slice(PRELUDE_PREFIX.length, -2);
        const parsed = JSON.parse(jsonText) as { tag: string; config?: { defaultUrl?: string } };
        expect(parsed.tag).toBe('ssp-status');
        expect(parsed.config?.defaultUrl).toBe('https://x.test/');
    });

    it('prepends bytes without touching the bundle content (D-11)', () => {
        const config = baseConfig();
        const bundleBytes = new TextEncoder().encode('console.log("pristine");');
        const packed = prependPrelude(bundleBytes, config);

        const newlineIndex = packed.indexOf(0x0a);
        const tail = packed.subarray(newlineIndex + 1);
        expect(tail).toEqual(bundleBytes);
    });

    it('extracts the tag from a prelude-prefixed bundle', () => {
        const config = baseConfig({ tagName: 'ssp-status' });
        const bundleBytes = new TextEncoder().encode('console.log(1);');
        const packed = prependPrelude(bundleBytes, config);

        expect(extractPreludeTag(packed)).toBe('ssp-status');
    });

    it('returns null for pristine bundle bytes', () => {
        const bundleBytes = new TextEncoder().encode('console.log(1);');
        expect(extractPreludeTag(bundleBytes)).toBeNull();
    });

    it('returns null rather than throwing on malformed prelude JSON', () => {
        const malformed = new TextEncoder().encode(`${PRELUDE_PREFIX}{not-json\n`);
        expect(extractPreludeTag(malformed)).toBeNull();
    });
});

describe('buildWidgetMetadata', () => {
    it('emits exactly the keys the Portal DTO reads -- no more, no less', () => {
        const metadata = buildWidgetMetadata(baseConfig());
        expect(Object.keys(metadata).sort()).toEqual(
            [
                'tagName',
                'name',
                'description',
                'changes',
                'tags',
                'defaultSize',
                'angularVersion',
                'authenticated',
                'dependencies',
                'fileFullName',
                'fileLightName'
            ].sort()
        );
    });
});

describe('packWidget', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-pack-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function writeConfig(config: SspWidgetConfig): string {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        return configPath;
    }

    it('produces exactly the four flat entries, no directory component in any name', async () => {
        const configPath = writeConfig(baseConfig({ tagName: 'ssp-status' }));
        const result = await packWidget({ configPath, outDir: tempDir });

        expect(result.entryNames.slice().sort()).toEqual(
            ['widget-metadata.json', 'ssp-status-1.0.0-full.js', 'ssp-status-1.0.0-light.js', 'portal-widget.json.txt'].sort()
        );
        expect(result.entryNames.every(name => !name.includes('/') && !name.includes('\\'))).toBe(true);
    });

    it('embeds the on-disk config byte-identical under the sidecar entry name (D-06)', async () => {
        const configPath = writeConfig(baseConfig({ tagName: 'ssp-status' }));
        const onDiskBytes = fs.readFileSync(configPath);

        const result = await packWidget({ configPath, outDir: tempDir });
        const unzipped = unzipSync(result.zipBytes);

        expect(unzipped['portal-widget.json.txt']).toEqual(new Uint8Array(onDiskBytes));
    });

    it('adds logo.png and both language filenames when configured, and nothing else', async () => {
        fs.writeFileSync(path.join(tempDir, 'logo.png'), Buffer.from([1, 2, 3]));
        fs.writeFileSync(path.join(tempDir, 'de.json'), '{}');
        fs.writeFileSync(path.join(tempDir, 'fr.json'), '{}');
        const configPath = writeConfig(
            baseConfig({
                tagName: 'ssp-status',
                logo: './logo.png',
                languageFiles: ['./de.json', './fr.json']
            })
        );

        const result = await packWidget({ configPath, outDir: tempDir });

        expect(result.entryNames.slice().sort()).toEqual(
            [
                'widget-metadata.json',
                'ssp-status-1.0.0-full.js',
                'ssp-status-1.0.0-light.js',
                'portal-widget.json.txt',
                'logo.png',
                'de.json',
                'fr.json'
            ].sort()
        );
    });

    it('leaves nothing behind but the .zip (CLI-01)', async () => {
        const configPath = writeConfig(baseConfig({ tagName: 'ssp-status' }));
        const before = fs.readdirSync(tempDir);

        await packWidget({ configPath, outDir: tempDir });

        const after = fs.readdirSync(tempDir);
        expect(after.length).toBe(before.length + 1);
        expect(after).toContain('ssp-status.zip');
    });

    it('names the written zip path and the Portal import location in nextAction (D-10/CLI-05)', async () => {
        const configPath = writeConfig(baseConfig({ tagName: 'ssp-status' }));
        const result = await packWidget({ configPath, outDir: tempDir });

        expect(result.nextAction).toContain(path.join(tempDir, 'ssp-status.zip'));
        expect(result.nextAction).toContain('admin/configuration?tab=4');
    });

    it('rejects a config whose template is not embed or custom, naming the field', async () => {
        const configPath = writeConfig(baseConfig({ template: 'unknown' }));

        await expect(packWidget({ configPath, outDir: tempDir })).rejects.toThrow(/template/);
    });
});

describe('packWidget custom template', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-pack-custom-'));
        fs.mkdirSync(path.join(tempDir, 'bundles'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function writeConfig(config: SspWidgetConfig): string {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        return configPath;
    }

    /** A one-line stand-in for a minified `customElements.define()` call -- the quoted tag survives minification, which is exactly the signal the coupling pre-flight checks for. */
    function writeBundle(fileName: string, tag: string | null): string {
        const filePath = path.join(tempDir, 'bundles', fileName);
        const content = tag
            ? `!function(){customElements.define("${tag}",class extends HTMLElement{});}();`
            : '!function(){console.log("no tag here");}();';
        fs.writeFileSync(filePath, content);
        return filePath;
    }

    it('packs a consultant\'s own built bundles byte-identical, with no prelude prepended, and refuses nothing (SCAF-04)', async () => {
        const fullPath = writeBundle('ssp-custom-widget-1.0.0-full.js', 'ssp-custom-widget');
        const lightPath = writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(baseCustomConfig());

        const result = await packWidget({ configPath, outDir: tempDir });
        const unzipped = unzipSync(result.zipBytes);

        expect(unzipped['ssp-custom-widget-1.0.0-full.js']).toEqual(new Uint8Array(fs.readFileSync(fullPath)));
        expect(unzipped['ssp-custom-widget-1.0.0-light.js']).toEqual(new Uint8Array(fs.readFileSync(lightPath)));
        expect(result.entryNames.slice().sort()).toEqual(
            [
                'widget-metadata.json',
                'ssp-custom-widget-1.0.0-full.js',
                'ssp-custom-widget-1.0.0-light.js',
                'portal-widget.json.txt'
            ].sort()
        );
    });

    it('resolves bundle paths relative to the config file\'s own directory, not the process cwd', async () => {
        writeBundle('ssp-custom-widget-1.0.0-full.js', 'ssp-custom-widget');
        writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(baseCustomConfig());

        const originalCwd = process.cwd();
        process.chdir(os.tmpdir());
        try {
            const result = await packWidget({ configPath, outDir: tempDir });
            expect(result.entryNames).toContain('ssp-custom-widget-1.0.0-full.js');
        } finally {
            process.chdir(originalCwd);
        }
    });

    it('fails naming the missing field when the "custom" member is absent', async () => {
        const configPath = writeConfig(baseCustomConfig({ custom: undefined }));

        await expect(packWidget({ configPath, outDir: tempDir })).rejects.toThrow(/custom/);
    });

    it('fails naming the resolved path and the build command when a bundle file does not exist', async () => {
        writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(baseCustomConfig());
        const expectedPath = path.join(tempDir, 'bundles', 'ssp-custom-widget-1.0.0-full.js');

        let caught: Error | undefined;
        try {
            await packWidget({ configPath, outDir: tempDir });
        } catch (error) {
            caught = error as Error;
        }

        expect(caught?.message).toContain(expectedPath);
        expect(caught?.message).toContain('build');
    });

    it('fails naming the tag and the bundle file when the declared tagName is not a quoted literal in the full bundle', async () => {
        const fullPath = writeBundle('ssp-custom-widget-1.0.0-full.js', null);
        writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(baseCustomConfig());

        let caught: Error | undefined;
        try {
            await packWidget({ configPath, outDir: tempDir });
        } catch (error) {
            caught = error as Error;
        }

        expect(caught?.message).toContain('ssp-custom-widget');
        expect(caught?.message).toContain(fullPath);
    });

    it('packs successfully once the declared tag is present in the full bundle', async () => {
        writeBundle('ssp-custom-widget-1.0.0-full.js', 'ssp-custom-widget');
        writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(baseCustomConfig());

        await expect(packWidget({ configPath, outDir: tempDir })).resolves.toBeDefined();
    });

    it('rejects an absolute bundle path', async () => {
        writeBundle('ssp-custom-widget-1.0.0-full.js', 'ssp-custom-widget');
        writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(
            baseCustomConfig({
                custom: {
                    fullBundlePath: path.join(tempDir, 'bundles', 'ssp-custom-widget-1.0.0-full.js'),
                    lightBundlePath: './bundles/ssp-custom-widget-1.0.0-light.js'
                }
            })
        );

        await expect(packWidget({ configPath, outDir: tempDir })).rejects.toThrow(/absolute path/);
    });

    it('rejects a bundle path that traverses outside the project directory', async () => {
        writeBundle('ssp-custom-widget-1.0.0-full.js', 'ssp-custom-widget');
        writeBundle('ssp-custom-widget-1.0.0-light.js', 'ssp-custom-widget');
        const configPath = writeConfig(
            baseCustomConfig({
                custom: {
                    fullBundlePath: '../../../etc/passwd',
                    lightBundlePath: './bundles/ssp-custom-widget-1.0.0-light.js'
                }
            })
        );

        await expect(packWidget({ configPath, outDir: tempDir })).rejects.toThrow(/outside the project directory/);
    });
});

describe('getEmbedBundleDir', () => {
    it('resolves assets/embed/ngNN directly under the given package root', () => {
        const syntheticPackageRoot = path.join(os.tmpdir(), 'fake-package-root');
        const resolved = getEmbedBundleDir(22, syntheticPackageRoot);
        expect(resolved).toBe(path.join(syntheticPackageRoot, 'assets', 'embed', 'ng22'));
    });
});
