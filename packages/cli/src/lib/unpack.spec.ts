import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { SspWidgetConfig } from './config';
import { WidgetMetadataJson } from './metadata';
import { CONFIG_FILE_NAME, ZIP_SIDECAR_ENTRY_NAME } from './package-identity';
import { packWidget } from './pack';
import { unpackWidget } from './unpack';

function baseConfig(overrides: Partial<SspWidgetConfig> = {}): SspWidgetConfig {
    return {
        template: 'embed',
        tagName: 'ssp-status-page',
        version: '1.0.0',
        name: [{ language: 'en', value: 'Status Page' }],
        description: [{ language: 'en', value: 'Status Page' }],
        changes: [{ language: 'en', value: 'Initial version' }],
        tags: [],
        defaultSize: { columns: 4, rows: 3 },
        angularVersion: 22,
        authenticated: false,
        dependencies: [],
        embed: { defaultUrl: 'https://status.example.com' },
        ...overrides
    };
}

function baseMetadata(overrides: Partial<WidgetMetadataJson> = {}): WidgetMetadataJson {
    return {
        tagName: 'ssp-alpha',
        name: [{ language: 'en', value: 'Alpha' }],
        description: [{ language: 'en', value: 'Alpha' }],
        changes: [{ language: 'en', value: 'Initial version' }],
        tags: [],
        defaultSize: { columns: 4, rows: 3 },
        angularVersion: 22,
        authenticated: false,
        dependencies: [],
        fileFullName: 'ssp-alpha-1.0.0-full.js',
        fileLightName: 'ssp-alpha-1.0.0-light.js',
        ...overrides
    };
}

function preludeBytes(tag: string, defaultUrl = 'https://x.test/'): Uint8Array {
    return strToU8(
        `globalThis.__SSP_WIDGET_DEF__=${JSON.stringify({ tag, template: 'embed', config: { defaultUrl } })};\nconsole.log(1);`
    );
}

function metadataEntry(metadata: WidgetMetadataJson): Uint8Array {
    return strToU8(JSON.stringify(metadata, null, 2));
}

describe('unpackWidget', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-unpack-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('round trip through packWidget (D-06)', () => {
        it('recovers portal-widget.json byte-identical to the config that produced the ZIP', async () => {
            const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-unpack-pack-'));
            try {
                const configPath = path.join(packDir, 'portal-widget.json');
                const configText = `${JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4)}\n`;
                fs.writeFileSync(configPath, configText);
                const originalBytes = fs.readFileSync(configPath);

                const packed = await packWidget({ configPath, outDir: packDir });
                fs.rmSync(configPath);

                const unpackDir = path.join(tempDir, 'unpacked');
                const result = await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir });

                const recoveredBytes = fs.readFileSync(result.configPath);
                expect(Buffer.compare(recoveredBytes, originalBytes)).toBe(0);
            } finally {
                fs.rmSync(packDir, { recursive: true, force: true });
            }
        });

        it('re-packs the recovered config to an archive with the same entry names as the original', async () => {
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4));

            const packed = await packWidget({ configPath, outDir: tempDir });
            const unpackDir = path.join(tempDir, 'unpacked');
            const result = await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir });

            const repacked = await packWidget({ configPath: result.configPath, outDir: unpackDir });
            expect(repacked.entryNames.slice().sort()).toEqual(packed.entryNames.slice().sort());
        });
    });

    describe('foreign, Portal-exported ZIP (no sidecar, WITH a prelude)', () => {
        it('synthesizes an embed config from widget-metadata.json and the bundle prelude', async () => {
            const zipBytes = zipSync(
                {
                    'widget-metadata.json': metadataEntry(baseMetadata({ tagName: 'ssp-alpha' })),
                    'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha', 'https://foreign.example.com/'),
                    'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha', 'https://foreign.example.com/')
                },
                { level: 0 }
            );
            const zipPath = path.join(tempDir, 'foreign.zip');
            fs.writeFileSync(zipPath, zipBytes);

            const result = await unpackWidget({ zipPath, outDir: path.join(tempDir, 'out') });
            const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8')) as SspWidgetConfig;

            expect(config.template).toBe('embed');
            expect(config.tagName).toBe('ssp-alpha');
            expect(config.name).toEqual(baseMetadata().name);
            expect(config.description).toEqual(baseMetadata().description);
            expect(config.changes).toEqual(baseMetadata().changes);
            expect(config.tags).toEqual([]);
            expect(config.defaultSize).toEqual({ columns: 4, rows: 3 });
            expect(config.angularVersion).toBe(22);
            expect(config.authenticated).toBe(false);
            expect(config.dependencies).toEqual([]);
            expect(config.version).toBe('1.0.0');
            expect(config.embed?.defaultUrl).toBe('https://foreign.example.com/');
        });
    });

    describe('foreign ZIP with NEITHER sidecar NOR prelude', () => {
        it('yields template "unknown" with a warning explaining what could not be recovered', async () => {
            const zipBytes = zipSync(
                {
                    'widget-metadata.json': metadataEntry(baseMetadata()),
                    'ssp-alpha-1.0.0-full.js': strToU8('console.log(1);'),
                    'ssp-alpha-1.0.0-light.js': strToU8('console.log(1);')
                },
                { level: 0 }
            );
            const zipPath = path.join(tempDir, 'unknown.zip');
            fs.writeFileSync(zipPath, zipBytes);

            const result = await unpackWidget({ zipPath, outDir: path.join(tempDir, 'out') });
            const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8')) as SspWidgetConfig;

            expect(config.template).toBe('unknown');
            const warning = result.issues.find(issue => issue.field === 'template');
            expect(warning?.severity).toBe('warning');
            expect(warning?.message).toContain('predates this tool');
            expect(warning?.message).toContain('cannot be checked');
            expect(warning?.message).toContain('will not work');
        });
    });

    describe('fileFullName not following the <tag>-<version>-full.js shape', () => {
        it('still unpacks, falling back to DEFAULT_WIDGET_VERSION rather than throwing', async () => {
            const zipBytes = zipSync(
                {
                    'widget-metadata.json': metadataEntry(
                        baseMetadata({ fileFullName: 'oddly-named-bundle.js', fileLightName: 'oddly-named-light.js' })
                    ),
                    'oddly-named-bundle.js': preludeBytes('ssp-alpha'),
                    'oddly-named-light.js': preludeBytes('ssp-alpha')
                },
                { level: 0 }
            );
            const zipPath = path.join(tempDir, 'odd.zip');
            fs.writeFileSync(zipPath, zipBytes);

            const result = await unpackWidget({ zipPath, outDir: path.join(tempDir, 'out') });
            const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8')) as SspWidgetConfig;

            expect(config.version).toBe('1.0.0');
        });
    });

    describe('logo and language files', () => {
        it('writes logo.png and language files beside the config, pointed at by relative path', async () => {
            fs.writeFileSync(path.join(tempDir, 'logo.png'), Buffer.from([1, 2, 3]));
            fs.writeFileSync(path.join(tempDir, 'de.json'), '{}');
            fs.writeFileSync(path.join(tempDir, 'fr.json'), '{}');
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(
                configPath,
                JSON.stringify(
                    baseConfig({
                        tagName: 'ssp-status-page',
                        logo: './logo.png',
                        languageFiles: ['./de.json', './fr.json']
                    }),
                    null,
                    4
                )
            );

            const packed = await packWidget({ configPath, outDir: tempDir });
            const unpackDir = path.join(tempDir, 'unpacked');
            const result = await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir });

            expect(fs.existsSync(path.join(unpackDir, 'logo.png'))).toBe(true);
            expect(fs.existsSync(path.join(unpackDir, 'de.json'))).toBe(true);
            expect(fs.existsSync(path.join(unpackDir, 'fr.json'))).toBe(true);

            const repacked = await packWidget({ configPath: result.configPath, outDir: unpackDir });
            expect(repacked.entryNames).toEqual(expect.arrayContaining(['logo.png', 'de.json', 'fr.json']));
        });
    });

    describe('withBundles', () => {
        it('does not write the bundles by default', async () => {
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4));
            const packed = await packWidget({ configPath, outDir: tempDir });

            const unpackDir = path.join(tempDir, 'unpacked-default');
            await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir });

            expect(fs.existsSync(path.join(unpackDir, 'ssp-status-page-1.0.0-full.js'))).toBe(false);
            expect(fs.existsSync(path.join(unpackDir, 'ssp-status-page-1.0.0-light.js'))).toBe(false);
        });

        it('writes both bundles under their archive names when withBundles is set', async () => {
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4));
            const packed = await packWidget({ configPath, outDir: tempDir });

            const unpackDir = path.join(tempDir, 'unpacked-with-bundles');
            await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir, withBundles: true });

            expect(fs.existsSync(path.join(unpackDir, 'ssp-status-page-1.0.0-full.js'))).toBe(true);
            expect(fs.existsSync(path.join(unpackDir, 'ssp-status-page-1.0.0-light.js'))).toBe(true);
        });
    });

    describe('zip-slip (T-02-01)', () => {
        it('rejects an entry with a parent-directory segment and leaves the output directory empty', async () => {
            const zipBytes = zipSync(
                {
                    'widget-metadata.json': metadataEntry(baseMetadata()),
                    'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
                    'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha'),
                    '../../../evil.txt': strToU8('pwned')
                },
                { level: 0 }
            );
            const zipPath = path.join(tempDir, 'evil.zip');
            fs.writeFileSync(zipPath, zipBytes);
            const outDir = path.join(tempDir, 'out');
            fs.mkdirSync(outDir);

            await expect(unpackWidget({ zipPath, outDir })).rejects.toThrow();
            expect(fs.readdirSync(outDir)).toHaveLength(0);
        });

        it('rejects an absolute POSIX-style entry name', async () => {
            const zipBytes = zipSync(
                {
                    'widget-metadata.json': metadataEntry(baseMetadata()),
                    'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
                    'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha'),
                    '/etc/evil.txt': strToU8('pwned')
                },
                { level: 0 }
            );
            const zipPath = path.join(tempDir, 'evil-abs.zip');
            fs.writeFileSync(zipPath, zipBytes);
            const outDir = path.join(tempDir, 'out-abs');
            fs.mkdirSync(outDir);

            await expect(unpackWidget({ zipPath, outDir })).rejects.toThrow();
            expect(fs.readdirSync(outDir)).toHaveLength(0);
        });
    });

    describe('overwrite protection', () => {
        it('fails the second run naming portal-widget.json, and succeeds with force set', async () => {
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4));
            const packed = await packWidget({ configPath, outDir: tempDir });

            const unpackDir = path.join(tempDir, 'unpack-twice');
            await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir });

            await expect(unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir })).rejects.toThrow(
                /portal-widget\.json/
            );

            await expect(
                unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir, force: true })
            ).resolves.toBeDefined();
        });
    });

    describe('decompression bomb (T-02-02)', () => {
        it('rejects an archive whose entries decompress past the cap, naming the cap, before any write', async () => {
            const big = new Uint8Array(65 * 1024 * 1024);
            const zipBytes = zipSync(
                {
                    'widget-metadata.json': metadataEntry(baseMetadata()),
                    'ssp-alpha-1.0.0-full.js': big,
                    'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha')
                },
                { level: 9 }
            );
            const zipPath = path.join(tempDir, 'bomb.zip');
            fs.writeFileSync(zipPath, zipBytes);
            const outDir = path.join(tempDir, 'out-bomb');
            fs.mkdirSync(outDir);

            await expect(unpackWidget({ zipPath, outDir })).rejects.toThrow(/64 MB/);
            expect(fs.readdirSync(outDir)).toHaveLength(0);
        });
    });

    it("carries a nextAction naming the written config path and telling the reader to edit it and run pack", async () => {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4));
        const packed = await packWidget({ configPath, outDir: tempDir });

        const unpackDir = path.join(tempDir, 'unpacked-next-action');
        const result = await unpackWidget({ zipPath: packed.zipPath, outDir: unpackDir });

        expect(result.nextAction).toContain(path.join(unpackDir, CONFIG_FILE_NAME));
        expect(result.nextAction.toLowerCase()).toContain('pack');
    });

    it('throws the same "widget-metadata.json missing" message the Portal reader throws', async () => {
        const zipBytes = zipSync({ [ZIP_SIDECAR_ENTRY_NAME]: strToU8('{}') }, { level: 0 });
        const zipPath = path.join(tempDir, 'no-metadata.zip');
        fs.writeFileSync(zipPath, zipBytes);

        await expect(unpackWidget({ zipPath, outDir: path.join(tempDir, 'out') })).rejects.toThrow(
            'widget-metadata.json missing'
        );
    });
});
