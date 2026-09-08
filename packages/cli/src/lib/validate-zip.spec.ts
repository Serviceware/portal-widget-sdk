import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { SspWidgetConfig } from './config';
import { WidgetMetadataJson } from './metadata';
import { CONFIG_FILE_NAME, ZIP_SIDECAR_ENTRY_NAME } from './package-identity';
import { packWidget } from './pack';
import { validateZip } from './validate';

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

function preludeBytes(tag: string): Uint8Array {
    return strToU8(`globalThis.__SSP_WIDGET_DEF__=${JSON.stringify({ tag, template: 'embed' })};\nconsole.log(1);`);
}

/** A one-line stand-in for a minified build-time `customElements.define()` call -- no prelude, same as a real scaffold bundle. */
function customBundleBytes(tag: string): Uint8Array {
    return strToU8(`!function(){customElements.define(${JSON.stringify(tag)},class extends HTMLElement{});}();`);
}

function baseCustomMetadata(overrides: Partial<WidgetMetadataJson> = {}): WidgetMetadataJson {
    return {
        tagName: 'ssp-custom-widget',
        name: [{ language: 'en', value: 'Custom Widget' }],
        description: [{ language: 'en', value: 'Custom Widget' }],
        changes: [{ language: 'en', value: 'Initial version' }],
        tags: [],
        defaultSize: { columns: 4, rows: 3 },
        angularVersion: 22,
        authenticated: false,
        dependencies: [],
        fileFullName: 'ssp-custom-widget-1.0.0-full.js',
        fileLightName: 'ssp-custom-widget-1.0.0-light.js',
        ...overrides
    };
}

/** Builds a valid custom-template ZIP -- both bundles prelude-free, sidecar declaring the given template (default `custom`). */
function buildCustomZip(metadataOverrides: Partial<WidgetMetadataJson> = {}, sidecarTemplateValue = 'custom'): Uint8Array {
    const metadata = baseCustomMetadata(metadataOverrides);
    const entries: Record<string, Uint8Array> = {
        'widget-metadata.json': metadataEntry(metadata),
        [ZIP_SIDECAR_ENTRY_NAME]: strToU8(JSON.stringify({ template: sidecarTemplateValue }))
    };
    if (metadata.fileFullName) {
        entries[metadata.fileFullName] = customBundleBytes('ssp-custom-widget');
    }
    if (metadata.fileLightName) {
        entries[metadata.fileLightName] = customBundleBytes('ssp-custom-widget');
    }
    return buildZip(entries);
}

function buildZip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync(entries, { level: 0 });
}

function metadataEntry(metadata: WidgetMetadataJson): Uint8Array {
    return strToU8(JSON.stringify(metadata, null, 2));
}

describe('validateZip', () => {
    it('validates a ZIP produced by packWidget with zero issues', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-validate-zip-'));
        try {
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'ssp-status-page' }), null, 4));

            const result = await packWidget({ configPath, outDir: tempDir });
            expect(validateZip(result.zipBytes)).toEqual([]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('PACK-07: tagName vs. bundle prelude coupling (D-15, C4)', () => {
        it('reports tagPreludeMismatch for both bundles when metadata tagName is ssp-alpha and both bundles carry ssp-beta', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-beta'),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-beta')
            });

            const issues = validateZip(zipBytes);
            const mismatches = issues.filter(item => item.code === 'tagPreludeMismatch');

            expect(mismatches).toHaveLength(2);
            mismatches.forEach(mismatch => {
                expect(mismatch.field).toBe('tagName');
                expect(mismatch.message).toContain('ssp-alpha');
                expect(mismatch.message).toContain('ssp-beta');
            });
        });

        it('reports tagPreludeMismatch when only the LIGHT bundle carries the wrong tag', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-beta')
            });

            const issues = validateZip(zipBytes);
            const mismatches = issues.filter(item => item.code === 'tagPreludeMismatch');

            expect(mismatches).toHaveLength(1);
            expect(mismatches[0].field).toBe('tagName');
            expect(mismatches[0].message).toContain('ssp-beta');
        });

        it('reports error-severity preludeMissing when the sidecar declares embed but neither bundle has a prelude', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': strToU8('console.log(1);'),
                'ssp-alpha-1.0.0-light.js': strToU8('console.log(1);'),
                [ZIP_SIDECAR_ENTRY_NAME]: strToU8(JSON.stringify({ template: 'embed' }))
            });

            const issues = validateZip(zipBytes);
            const preludeMissing = issues.find(item => item.code === 'preludeMissing');

            expect(preludeMissing?.severity).toBe('error');
            expect(preludeMissing?.field).toBe('tagName');
        });

        it('reports warning-severity preludeMissing with no sidecar and no prelude at all', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': strToU8('console.log(1);'),
                'ssp-alpha-1.0.0-light.js': strToU8('console.log(1);')
            });

            const issues = validateZip(zipBytes);
            const preludeMissing = issues.find(item => item.code === 'preludeMissing');

            expect(preludeMissing?.severity).toBe('warning');
        });
    });

    it('errors with the Portal reader\'s own message when widget-metadata.json is missing', () => {
        const zipBytes = buildZip({ 'extra.json': strToU8('{}') });
        const issues = validateZip(zipBytes);

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ severity: 'error', field: 'widget-metadata.json', code: 'fileNotFound' });
        expect(issues[0].message).toContain('widget-metadata.json missing');
    });

    describe('fileFullName / fileLightName', () => {
        it('errors on fileFullName when it names an entry not present in the archive', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata({ fileFullName: 'missing-full.js' })),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha')
            });

            const issues = validateZip(zipBytes);
            expect(issues.some(item => item.field === 'fileFullName' && item.code === 'fileNotFound')).toBe(true);
        });

        it('errors on fileLightName when it names an entry not present in the archive', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata({ fileLightName: 'missing-light.js' })),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha')
            });

            const issues = validateZip(zipBytes);
            expect(issues.some(item => item.field === 'fileLightName' && item.code === 'fileNotFound')).toBe(true);
        });

        it('errors when fileLightName is missing entirely from the metadata (D-13: the upload form requires both)', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata({ fileLightName: undefined })),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha')
            });

            const issues = validateZip(zipBytes);
            expect(issues.some(item => item.field === 'fileLightName' && item.code === 'required')).toBe(true);
        });
    });

    it('reports notFlat for an entry name containing a directory separator', () => {
        const zipBytes = buildZip({
            'widget-metadata.json': metadataEntry(baseMetadata()),
            'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
            'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha'),
            'nested/entry.js': strToU8('x')
        });

        const issues = validateZip(zipBytes);
        expect(issues.some(item => item.code === 'notFlat' && item.field === 'nested/entry.js')).toBe(true);
    });

    describe('C2 inverse: a foreign flat portal-widget.json must not pass silently', () => {
        it('reports invalidLanguageFileName for a flat portal-widget.json entry (not the .json.txt sidecar)', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha'),
                [CONFIG_FILE_NAME]: strToU8(JSON.stringify({ some: 'config' }))
            });

            const issues = validateZip(zipBytes);
            const found = issues.find(item => item.field === CONFIG_FILE_NAME);
            expect(found?.code).toBe('invalidLanguageFileName');
        });

        it('produces no issue at all for the correct portal-widget.json.txt sidecar', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha'),
                [ZIP_SIDECAR_ENTRY_NAME]: strToU8(JSON.stringify({ some: 'config' }))
            });

            expect(validateZip(zipBytes)).toEqual([]);
        });
    });

    describe('size ceilings', () => {
        it('reports size_invalid stating 10 MB for a 12 MB full bundle', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': new Uint8Array(12 * 1024 * 1024),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha')
            });

            const issues = validateZip(zipBytes);
            const found = issues.find(item => item.field === 'fileFullName' && item.code === 'size_invalid');
            expect(found?.message).toContain('10 MB');
        });

        it('reports size_invalid stating 2 MB for a 3 MB logo.png', () => {
            const zipBytes = buildZip({
                'widget-metadata.json': metadataEntry(baseMetadata()),
                'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
                'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha'),
                'logo.png': new Uint8Array(3 * 1024 * 1024)
            });

            const issues = validateZip(zipBytes);
            const found = issues.find(item => item.field === 'logo' && item.code === 'size_invalid');
            expect(found?.message).toContain('2 MB');
        });
    });

    it('runs the task-1 field rules against the ZIP\'s own metadata: no English name produces englishRequired', () => {
        const zipBytes = buildZip({
            'widget-metadata.json': metadataEntry(baseMetadata({ name: [{ language: 'de', value: 'Alpha' }] })),
            'ssp-alpha-1.0.0-full.js': preludeBytes('ssp-alpha'),
            'ssp-alpha-1.0.0-light.js': preludeBytes('ssp-alpha')
        });

        const issues = validateZip(zipBytes);
        expect(issues.some(item => item.field === 'name' && item.code === 'englishRequired')).toBe(true);
    });

    describe('packWidget gating', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-pack-gate-'));
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('rejects a config with a hyphen-less tagName, naming the field, and writes no ZIP', async () => {
            const configPath = path.join(tempDir, 'portal-widget.json');
            fs.writeFileSync(configPath, JSON.stringify(baseConfig({ tagName: 'embedwidget' }), null, 4));

            await expect(packWidget({ configPath, outDir: tempDir })).rejects.toThrow(/tagName/);
            expect(fs.readdirSync(tempDir).some(name => name.endsWith('.zip'))).toBe(false);
        });
    });

    describe('custom template (SCAF-04: validate needs no source change)', () => {
        it('validates a valid custom-template ZIP with zero errors and exactly one preludeMissing warning describing build-time registration', () => {
            const issues = validateZip(buildCustomZip());

            const errors = issues.filter(item => item.severity === 'error');
            const warnings = issues.filter(item => item.severity === 'warning');

            expect(errors).toHaveLength(0);
            expect(warnings).toHaveLength(1);
            expect(warnings[0].code).toBe('preludeMissing');
            expect(warnings[0].message).toContain('register its custom element at build time');
        });

        it('reports an ERROR, not a warning, when the sidecar declares embed but neither bundle carries a prelude (PACK-07 stays intact)', () => {
            const issues = validateZip(buildCustomZip({}, 'embed'));

            const preludeMissing = issues.find(item => item.code === 'preludeMissing');
            expect(preludeMissing?.severity).toBe('error');
        });

        it('runs every field-rule family identically against a custom ZIP -- one representative failure per family', () => {
            expect(validateZip(buildCustomZip({ tagName: '' })).some(item => item.field === 'tagName' && item.code === 'required')).toBe(true);

            expect(
                validateZip(buildCustomZip({ name: [{ language: 'de', value: 'Custom Widget' }] })).some(
                    item => item.field === 'name' && item.code === 'englishRequired'
                )
            ).toBe(true);

            expect(validateZip(buildCustomZip({ description: [] })).some(item => item.field === 'description' && item.code === 'required')).toBe(
                true
            );

            expect(validateZip(buildCustomZip({ changes: [] })).some(item => item.field === 'changes' && item.code === 'required')).toBe(true);

            expect(
                validateZip(buildCustomZip({ tags: Array.from({ length: 11 }, (_, index) => `tag${index}`) })).some(
                    item => item.field === 'tags' && item.code === 'maxReached'
                )
            ).toBe(true);

            expect(
                validateZip(buildCustomZip({ dependencies: [{ name: '', dependency: '' }] })).some(
                    item => item.field === 'dependencies' && item.code === 'required'
                )
            ).toBe(true);

            expect(
                validateZip(buildCustomZip({ defaultSize: { columns: 0, rows: 3 } })).some(
                    item => item.field === 'defaultSize.columns' && item.code === 'invalidNumber'
                )
            ).toBe(true);

            expect(
                validateZip(buildCustomZip({ angularVersion: 100 })).some(item => item.field === 'angularVersion' && item.code === 'invalidNumber')
            ).toBe(true);

            const withLogo = buildZip({
                'widget-metadata.json': metadataEntry(baseCustomMetadata()),
                'ssp-custom-widget-1.0.0-full.js': customBundleBytes('ssp-custom-widget'),
                'ssp-custom-widget-1.0.0-light.js': customBundleBytes('ssp-custom-widget'),
                [ZIP_SIDECAR_ENTRY_NAME]: strToU8(JSON.stringify({ template: 'custom' })),
                'logo.png': new Uint8Array(3 * 1024 * 1024)
            });
            expect(validateZip(withLogo).some(item => item.field === 'logo' && item.code === 'size_invalid')).toBe(true);

            const withBogusLanguageFile = buildZip({
                'widget-metadata.json': metadataEntry(baseCustomMetadata()),
                'ssp-custom-widget-1.0.0-full.js': customBundleBytes('ssp-custom-widget'),
                'ssp-custom-widget-1.0.0-light.js': customBundleBytes('ssp-custom-widget'),
                [ZIP_SIDECAR_ENTRY_NAME]: strToU8(JSON.stringify({ template: 'custom' })),
                '1.json': strToU8('{}')
            });
            expect(validateZip(withBogusLanguageFile).some(item => item.code === 'invalidLanguageFileName')).toBe(true);

            const withNestedEntry = buildZip({
                'widget-metadata.json': metadataEntry(baseCustomMetadata()),
                'ssp-custom-widget-1.0.0-full.js': customBundleBytes('ssp-custom-widget'),
                'ssp-custom-widget-1.0.0-light.js': customBundleBytes('ssp-custom-widget'),
                [ZIP_SIDECAR_ENTRY_NAME]: strToU8(JSON.stringify({ template: 'custom' })),
                'nested/entry.js': strToU8('x')
            });
            expect(validateZip(withNestedEntry).some(item => item.code === 'notFlat')).toBe(true);

            expect(
                validateZip(buildCustomZip({ fileLightName: undefined })).some(item => item.field === 'fileLightName' && item.code === 'required')
            ).toBe(true);
        });
    });
});
