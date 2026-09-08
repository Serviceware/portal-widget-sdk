import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { unzipSync } from 'fflate';
import { SspWidgetConfig } from './config';
import { packWidget } from './pack';
import { CONFIG_FILE_NAME } from './package-identity';
import { isValidCustomElementName } from './rules';
import { slugifyTag } from './slugify';
import { WizardIo, runWizard } from './wizard';

interface TestIo {
    io: WizardIo;
    askedQuestions: string[];
    log: string[];
}

function createTestIo(answers: string[]): TestIo {
    const askedQuestions: string[] = [];
    const log: string[] = [];
    const io: WizardIo = {
        ask: async (question: string) => {
            askedQuestions.push(question);
            return answers[askedQuestions.length - 1] ?? '';
        },
        log: (line: string) => log.push(line)
    };
    return { io, askedQuestions, log };
}

function readConfigFile(configPath: string): SspWidgetConfig {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as SspWidgetConfig;
}

describe('slugifyTag', () => {
    it.each([
        ['Status Page', 'ssp-status-page'],
        ['Status', 'ssp-status'],
        ['1 Page', 'ssp-1-page']
    ])('derives %s -> %s', (input, expected) => {
        expect(slugifyTag(input)).toBe(expected);
    });

    it('strips non-ASCII characters entirely from a display name with diacritics', () => {
        const tag = slugifyTag('Über uns');
        const hasNonAscii = Array.from(tag).some(char => (char.codePointAt(0) ?? 0) > 0x7f);
        expect(hasNonAscii).toBe(false);
        expect(isValidCustomElementName(tag)).toBe(true);
    });

    it('never leaves a doubled or trailing hyphen', () => {
        const tag = slugifyTag('A---B');
        expect(tag).not.toMatch(/--/);
        expect(tag.endsWith('-')).toBe(false);
        expect(isValidCustomElementName(tag)).toBe(true);
    });

    it('truncates a 200-character name to at most 100 characters with no trailing hyphen', () => {
        const tag = slugifyTag('x'.repeat(200));
        expect(tag.length).toBeLessThanOrEqual(100);
        expect(tag.endsWith('-')).toBe(false);
        expect(isValidCustomElementName(tag)).toBe(true);
    });

    it.each(['----', ''])('falls back to a valid tag rather than an invalid one or a crash for %j', input => {
        const tag = slugifyTag(input);
        expect(isValidCustomElementName(tag)).toBe(true);
    });
});

describe('runWizard', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-widget-wizard-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('embed path', () => {
        it('exactly two questions follow the path choice, writes config + zip', async () => {
            const { io, askedQuestions } = createTestIo(['embed', 'Status Page', 'https://status.example.com']);
            const result = await runWizard(io, tempDir);

            expect(result.path).toBe('embed');
            expect(askedQuestions.length - 1).toBe(2);
            expect(fs.existsSync(result.configPath)).toBe(true);
            expect(result.zipPath && fs.existsSync(result.zipPath)).toBe(true);
        });

        it("derived values: changes 'Initial version', size 4x3, authenticated false, empty tags/dependencies, version 1.0.0, description repeats the name", async () => {
            const { io } = createTestIo(['embed', 'Status Page', 'https://status.example.com']);
            const result = await runWizard(io, tempDir);

            const config = readConfigFile(result.configPath);

            expect(config.changes).toEqual([{ language: 'en', value: 'Initial version' }]);
            expect(config.defaultSize).toEqual({ columns: 4, rows: 3 });
            expect(config.authenticated).toBe(false);
            expect(config.tags).toEqual([]);
            expect(config.dependencies).toEqual([]);
            expect(config.version).toBe('1.0.0');
            expect(config.name).toEqual([{ language: 'en', value: 'Status Page' }]);
            expect(config.description).toEqual([{ language: 'en', value: 'Status Page' }]);
            expect(config.template).toBe('embed');
            expect(config.embed?.defaultUrl).toBe('https://status.example.com');
        });

        it('re-asks on a blank display name or a blank URL rather than writing a broken config', async () => {
            const { io } = createTestIo(['embed', '', 'Status Page', '', 'https://status.example.com']);
            const result = await runWizard(io, tempDir);

            expect(result.path).toBe('embed');
            const config = readConfigFile(result.configPath);
            expect(config.name[0].value).toBe('Status Page');
            expect(config.embed?.defaultUrl).toBe('https://status.example.com');
        });

        it('stops rather than overwriting an existing config, pointing at pack', async () => {
            fs.writeFileSync(path.join(tempDir, CONFIG_FILE_NAME), '{"already":"here"}');
            const { io, log, askedQuestions } = createTestIo(['embed']);

            const result = await runWizard(io, tempDir);

            expect(result.path).toBe('embed');
            expect(result.zipPath).toBeUndefined();
            expect(askedQuestions).toHaveLength(1);
            expect(log.join('\n')).toContain('pack');
            expect(fs.readFileSync(path.join(tempDir, CONFIG_FILE_NAME), 'utf8')).toBe('{"already":"here"}');
        });

        it("the wizard's own output ends with the same next action pack prints", async () => {
            const { io, log } = createTestIo(['embed', 'Status Page', 'https://status.example.com']);
            const result = await runWizard(io, tempDir);

            expect(log[log.length - 1]).toBe(result.nextAction);
            expect(result.nextAction).toContain('admin/configuration?tab=4');
        });

        it('the written config is independently re-packable via packWidget, with no wizard involved', async () => {
            const { io } = createTestIo(['embed', 'Status Page', 'https://status.example.com']);
            const result = await runWizard(io, tempDir);

            const originalEntries = Object.keys(unzipSync(fs.readFileSync(result.zipPath as string))).sort();

            const repackDir = path.join(tempDir, 'repack');
            const repacked = await packWidget({ configPath: result.configPath, outDir: repackDir });

            expect(repacked.entryNames.slice().sort()).toEqual(originalEntries);
        });
    });

    describe('custom path (bring your own bundles, any framework)', () => {
        const expectedTag = slugifyTag('Weather Widget');
        const expectedFull = `bundles/${expectedTag}-1.0.0-full.js`;
        const expectedLight = `bundles/${expectedTag}-1.0.0-light.js`;

        it('asks only the display name -- no URL question', async () => {
            const { io, askedQuestions } = createTestIo(['custom', 'Weather Widget']);
            await runWizard(io, tempDir);

            expect(askedQuestions.length - 1).toBe(1);
        });

        it('writes a template "custom" config at cwd that names both bundle paths and no embed block, and produces no ZIP', async () => {
            const { io } = createTestIo(['custom', 'Weather Widget']);
            const result = await runWizard(io, tempDir);

            expect(result.path).toBe('custom');
            expect(result.configPath).toBe(path.join(tempDir, CONFIG_FILE_NAME));
            expect(result.zipPath).toBeUndefined();

            const config = readConfigFile(result.configPath);
            expect(config.template).toBe('custom');
            expect(config.tagName).toBe(expectedTag);
            expect(config.custom).toEqual({ fullBundlePath: expectedFull, lightBundlePath: expectedLight });
            expect(config.embed).toBeUndefined();
            expect(config.name).toEqual([{ language: 'en', value: 'Weather Widget' }]);
        });

        it("declares angularVersion 0 -- the Portal's value for a non-Angular widget, so the full bundle is always used", async () => {
            const { io } = createTestIo(['custom', 'Weather Widget']);
            const result = await runWizard(io, tempDir);

            expect(readConfigFile(result.configPath).angularVersion).toBe(0);
        });

        it('its next action names the config, both bundle paths, the tag the bundles must register, and pack -- and is the last line logged', async () => {
            const { io, log } = createTestIo(['custom', 'Weather Widget']);
            const result = await runWizard(io, tempDir);

            expect(result.nextAction).toContain(result.configPath);
            expect(result.nextAction).toContain(expectedFull);
            expect(result.nextAction).toContain(expectedLight);
            expect(result.nextAction).toContain(`customElements.define('${expectedTag}'`);
            expect(result.nextAction).toContain('pack');
            expect(log[log.length - 1]).toBe(result.nextAction);
        });

        it('stops rather than overwriting an existing config', async () => {
            fs.writeFileSync(path.join(tempDir, CONFIG_FILE_NAME), '{"already":"here"}');
            const { io, askedQuestions } = createTestIo(['custom']);

            const result = await runWizard(io, tempDir);

            expect(result.path).toBe('custom');
            expect(askedQuestions).toHaveLength(1);
            expect(fs.readFileSync(path.join(tempDir, CONFIG_FILE_NAME), 'utf8')).toBe('{"already":"here"}');
        });

        it('packs once bundles registering the tag exist at the named paths, with no wizard involved', async () => {
            const { io } = createTestIo(['custom', 'Weather Widget']);
            const result = await runWizard(io, tempDir);

            fs.mkdirSync(path.join(tempDir, 'bundles'));
            const bundleSource = `customElements.define('${expectedTag}', class extends HTMLElement {});\n`;
            fs.writeFileSync(path.join(tempDir, expectedFull), bundleSource);
            fs.writeFileSync(path.join(tempDir, expectedLight), bundleSource);

            const packed = await packWidget({ configPath: result.configPath, outDir: tempDir });

            expect(fs.existsSync(packed.zipPath)).toBe(true);
            expect(packed.entryNames).toContain(`${expectedTag}-1.0.0-full.js`);
            expect(packed.entryNames).toContain(`${expectedTag}-1.0.0-light.js`);
        });
    });
});
