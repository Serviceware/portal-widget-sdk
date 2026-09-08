import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SspWidgetConfig } from './config';
import { formatIssues, validateConfig, ValidationIssue } from './validate';

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

function issueFor(issues: ValidationIssue[], field: string): ValidationIssue | undefined {
    return issues.find(item => item.field === field);
}

describe('validateConfig', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-validate-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('tagName', () => {
        it('reports required when empty', () => {
            const issues = validateConfig(baseConfig({ tagName: '' }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('required');
        });

        it('reports maxLengthExceeded past 100 characters', () => {
            const issues = validateConfig(baseConfig({ tagName: `ssp-${'a'.repeat(100)}` }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('maxLengthExceeded');
        });

        it('reports invalidTagName for uppercase characters', () => {
            const issues = validateConfig(baseConfig({ tagName: 'Ssp-Embed' }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('invalidTagName');
        });

        it('reports invalidTagName for an underscore', () => {
            const issues = validateConfig(baseConfig({ tagName: 'ssp_embed' }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('invalidTagName');
        });

        it('reports notACustomElementName for a hyphen-less tag, naming the browser constraint (PACK-06, D-16)', () => {
            const issues = validateConfig(baseConfig({ tagName: 'embedwidget' }), tempDir);
            const found = issueFor(issues, 'tagName');
            expect(found?.code).toBe('notACustomElementName');
            expect(found?.message).toMatch(/customElements\.define/);
        });

        it('reports notACustomElementName for a leading digit', () => {
            const issues = validateConfig(baseConfig({ tagName: '1-widget' }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('notACustomElementName');
        });

        it('reports notACustomElementName for a trailing hyphen', () => {
            const issues = validateConfig(baseConfig({ tagName: 'portal-widget-' }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('notACustomElementName');
        });

        it('reports notACustomElementName for a reserved element name', () => {
            const issues = validateConfig(baseConfig({ tagName: 'font-face' }), tempDir);
            expect(issueFor(issues, 'tagName')?.code).toBe('notACustomElementName');
        });

        it('accepts a valid tag', () => {
            const issues = validateConfig(baseConfig({ tagName: 'ssp-status-page' }), tempDir);
            expect(issueFor(issues, 'tagName')).toBeUndefined();
        });
    });

    describe('multilanguage fields', () => {
        it('reports englishRequired on name when there is no en entry', () => {
            const issues = validateConfig(baseConfig({ name: [{ language: 'de', value: 'Statusseite' }] }), tempDir);
            expect(issueFor(issues, 'name')?.code).toBe('englishRequired');
        });

        it('reports englishRequired on name when the en entry is whitespace', () => {
            const issues = validateConfig(baseConfig({ name: [{ language: 'en', value: '   ' }] }), tempDir);
            expect(issueFor(issues, 'name')?.code).toBe('englishRequired');
        });

        it('reports required on description when the array is empty', () => {
            const issues = validateConfig(baseConfig({ description: [] }), tempDir);
            expect(issueFor(issues, 'description')?.code).toBe('required');
        });

        it('reports englishRequired on changes independently of name', () => {
            const issues = validateConfig(baseConfig({ changes: [{ language: 'de', value: 'x' }] }), tempDir);
            expect(issueFor(issues, 'changes')?.code).toBe('englishRequired');
        });

        it('reports maxLengthExceeded on name past 100 characters', () => {
            const issues = validateConfig(baseConfig({ name: [{ language: 'en', value: 'a'.repeat(101) }] }), tempDir);
            expect(issueFor(issues, 'name')?.code).toBe('maxLengthExceeded');
        });

        it('does not trip description at 100 characters -- its ceiling is 4000', () => {
            const issues = validateConfig(
                baseConfig({ description: [{ language: 'en', value: 'a'.repeat(101) }] }),
                tempDir
            );
            expect(issueFor(issues, 'description')).toBeUndefined();
        });

        it('does not trip changes at 100 characters -- its ceiling is 4000', () => {
            const issues = validateConfig(baseConfig({ changes: [{ language: 'en', value: 'a'.repeat(101) }] }), tempDir);
            expect(issueFor(issues, 'changes')).toBeUndefined();
        });
    });

    describe('tags', () => {
        it('reports maxReached at 11 tags', () => {
            const issues = validateConfig(
                baseConfig({ tags: Array.from({ length: 11 }, (_, index) => `tag${index}`) }),
                tempDir
            );
            expect(issueFor(issues, 'tags')?.code).toBe('maxReached');
        });

        it('reports invalidTag for a tag containing a space', () => {
            const issues = validateConfig(baseConfig({ tags: ['has space'] }), tempDir);
            expect(issueFor(issues, 'tags')?.code).toBe('invalidTag');
        });
    });

    describe('dependencies', () => {
        it('reports maxReached at 11 dependencies', () => {
            const dependencies = Array.from({ length: 11 }, (_, index) => ({ name: `dep${index}`, dependency: '1.0.0' }));
            const issues = validateConfig(baseConfig({ dependencies }), tempDir);
            expect(issueFor(issues, 'dependencies')?.code).toBe('maxReached');
        });

        it('reports required for a dependency with a blank dependency value', () => {
            const issues = validateConfig(baseConfig({ dependencies: [{ name: 'dep', dependency: '' }] }), tempDir);
            expect(issueFor(issues, 'dependencies')?.code).toBe('required');
        });
    });

    describe('numeric ranges', () => {
        it.each([0, 13, 2.5])('reports invalidNumber on defaultSize.columns for %s', value => {
            const issues = validateConfig(baseConfig({ defaultSize: { columns: value, rows: 3 } }), tempDir);
            expect(issueFor(issues, 'defaultSize.columns')?.code).toBe('invalidNumber');
        });

        it.each([0, 13, 2.5])('reports invalidNumber on defaultSize.rows for %s', value => {
            const issues = validateConfig(baseConfig({ defaultSize: { columns: 4, rows: value } }), tempDir);
            expect(issueFor(issues, 'defaultSize.rows')?.code).toBe('invalidNumber');
        });

        it.each([-1, 100])('reports invalidNumber on angularVersion for %s', value => {
            const issues = validateConfig(baseConfig({ angularVersion: value }), tempDir);
            expect(issueFor(issues, 'angularVersion')?.code).toBe('invalidNumber');
        });

        it.each([0, 99])('accepts angularVersion boundary %s', value => {
            const issues = validateConfig(baseConfig({ angularVersion: value }), tempDir);
            expect(issueFor(issues, 'angularVersion')).toBeUndefined();
        });
    });

    describe('logo', () => {
        it('reports size_invalid past 2 MB, stating 2 MB', () => {
            fs.writeFileSync(path.join(tempDir, 'logo.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
            const issues = validateConfig(baseConfig({ logo: './logo.png' }), tempDir);
            const found = issueFor(issues, 'logo');
            expect(found?.code).toBe('size_invalid');
            expect(found?.message).toContain('2 MB');
        });

        it('reports fileNotFound for a missing logo path, naming the resolved absolute path', () => {
            const issues = validateConfig(baseConfig({ logo: './missing.png' }), tempDir);
            const found = issueFor(issues, 'logo');
            expect(found?.code).toBe('fileNotFound');
            expect(found?.message).toContain(path.resolve(tempDir, './missing.png'));
        });
    });

    describe('languageFiles', () => {
        it('reports size_invalid over 1 MB stating 1 MB, and never states 5 MB (C3)', () => {
            fs.writeFileSync(path.join(tempDir, 'de.json'), Buffer.alloc(1024 * 1024 + 1, '{'));
            const issues = validateConfig(baseConfig({ languageFiles: ['./de.json'] }), tempDir);
            const found = issueFor(issues, 'languageFiles[0]');
            expect(found?.code).toBe('size_invalid');
            expect(found?.message).toContain('1 MB');
            expect(found?.message).not.toContain('5 MB');
        });

        it('reports invalidJson for unparseable content', () => {
            fs.writeFileSync(path.join(tempDir, 'de.json'), 'not json');
            const issues = validateConfig(baseConfig({ languageFiles: ['./de.json'] }), tempDir);
            expect(issueFor(issues, 'languageFiles[0]')?.code).toBe('invalidJson');
        });

        it('reports empty for a zero-byte file', () => {
            fs.writeFileSync(path.join(tempDir, 'de.json'), '');
            const issues = validateConfig(baseConfig({ languageFiles: ['./de.json'] }), tempDir);
            expect(issueFor(issues, 'languageFiles[0]')?.code).toBe('empty');
        });

        it('reports invalidLanguageFileName for translations.json, explaining the silent Portal drop', () => {
            fs.writeFileSync(path.join(tempDir, 'translations.json'), '{}');
            const issues = validateConfig(baseConfig({ languageFiles: ['./translations.json'] }), tempDir);
            const found = issueFor(issues, 'languageFiles[0]');
            expect(found?.code).toBe('invalidLanguageFileName');
            expect(found?.message).toMatch(/drop|silently/i);
        });

        it('accepts de.json', () => {
            fs.writeFileSync(path.join(tempDir, 'de.json'), '{}');
            const issues = validateConfig(baseConfig({ languageFiles: ['./de.json'] }), tempDir);
            expect(issueFor(issues, 'languageFiles[0]')).toBeUndefined();
        });

        it('accepts pt-BR.json', () => {
            fs.writeFileSync(path.join(tempDir, 'pt-BR.json'), '{}');
            const issues = validateConfig(baseConfig({ languageFiles: ['./pt-BR.json'] }), tempDir);
            expect(issueFor(issues, 'languageFiles[0]')).toBeUndefined();
        });

        it('reports fileNotFound naming the resolved absolute path', () => {
            const issues = validateConfig(baseConfig({ languageFiles: ['./missing.json'] }), tempDir);
            const found = issueFor(issues, 'languageFiles[0]');
            expect(found?.code).toBe('fileNotFound');
            expect(found?.message).toContain(path.resolve(tempDir, './missing.json'));
        });
    });

    it('produces an empty issue list for a fully valid config', () => {
        fs.writeFileSync(path.join(tempDir, 'logo.png'), Buffer.from([1, 2, 3]));
        fs.writeFileSync(path.join(tempDir, 'de.json'), '{}');
        const issues = validateConfig(baseConfig({ logo: './logo.png', languageFiles: ['./de.json'] }), tempDir);
        expect(issues).toEqual([]);
    });
});

describe('formatIssues', () => {
    it('renders one line per issue with field, severity, and message', () => {
        const issues: ValidationIssue[] = [
            { severity: 'error', field: 'tagName', code: 'required', message: 'tagName is required.' }
        ];
        const output = formatIssues(issues);
        expect(output).toContain('tagName');
        expect(output).toContain('error');
        expect(output).toContain('tagName is required.');
    });

    it('returns a distinguishable no-problems line for an empty list', () => {
        expect(formatIssues([])).toMatch(/no problems/i);
    });
});
