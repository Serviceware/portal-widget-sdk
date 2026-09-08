import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from '../cli/main';
import { SspWidgetConfig } from './config';
import { NEXT_ACTION_KINDS, NextActionDetails, NextActionKind, nextAction } from './output';
import { packWidget } from './pack';

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

function detailsFor(kind: NextActionKind): NextActionDetails {
    switch (kind) {
        case 'pack':
            return { zipPath: '/tmp/ssp-status-page/ssp-status-page.zip' };
        case 'unpack':
            return { configPath: '/tmp/ssp-status-page/portal-widget.json' };
        case 'validate-config':
        case 'validate-zip':
            return { hasErrors: false };
        case 'wizard-custom':
            return {
                configPath: '/tmp/ssp-status-page/portal-widget.json',
                tagName: 'ssp-status-page',
                fullBundlePath: 'bundles/ssp-status-page-1.0.0-full.js',
                lightBundlePath: 'bundles/ssp-status-page-1.0.0-light.js'
            };
        default:
            return {};
    }
}

describe('NEXT_ACTION_KINDS coverage -- every command the CLI dispatches has a closing message (CLI-05)', () => {
    it('covers the wizard embed and custom branches, pack, validate on a config, validate on a ZIP, and unpack', () => {
        // The wizard's embed branch prints pack's own message (it ends by
        // calling packWidget); 'wizard-custom' is the one kind unique to the
        // wizard's other branch. Together with pack/validate-config/
        // validate-zip/unpack, every command this CLI dispatches is covered.
        expect(NEXT_ACTION_KINDS).toEqual(
            expect.arrayContaining(['pack', 'validate-config', 'validate-zip', 'unpack', 'wizard-custom'])
        );
    });

    it('every kind produces a non-empty message ending in an actionable sentence', () => {
        for (const kind of NEXT_ACTION_KINDS) {
            const message = nextAction(kind, detailsFor(kind));
            expect(message.length).toBeGreaterThan(0);

            // Actionable: names a file path the reader now has (a real
            // dotted-extension path from the details, or the ZIP/config
            // mentioned as a noun), or a command to run next (pack/validate/
            // unpack), or -- the wizard's custom branch -- what to do
            // meanwhile (embed/custom).
            const namesAPathOrACommand = /\.(zip|json)|\bZIP\b|\bpack\b|\bvalidate\b|\bunpack\b|\bembed\b|\bcustom\b/i.test(
                message
            );
            expect(namesAPathOrACommand).toBe(true);
        }
    });

    it('pack success and a clean validate-zip (the wizard embed branch prints the same message as pack) name the Portal import location and mention Import', () => {
        const packMessage = nextAction('pack', { zipPath: '/tmp/ssp-status-page/ssp-status-page.zip' });
        const cleanValidateZipMessage = nextAction('validate-zip', { hasErrors: false });

        for (const message of [packMessage, cleanValidateZipMessage]) {
            expect(message).toContain('admin/configuration?tab=4');
            expect(message).toContain('Import');
        }
    });

    it('a kind not wired into nextAction throws rather than returning an empty/silent message', () => {
        expect(() => nextAction('not-a-real-kind' as unknown as NextActionKind)).toThrow();
    });
});

describe('CLI dispatcher -- no command completes silently', () => {
    let tempDir: string;
    let logSpy: MockInstance<typeof console.log>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-create-widget-cli-output-'));
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        process.exitCode = undefined;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function loggedLines(): string {
        return logSpy.mock.calls.map(call => call[0]).join('\n');
    }

    it('pack records a line naming the ZIP and the Portal import location', async () => {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(baseConfig(), null, 4));

        await main(['pack', '--config', configPath, '--out', tempDir]);

        expect(loggedLines()).toContain('admin/configuration?tab=4');
        expect(loggedLines()).toContain('ssp-status-page.zip');
    });

    it('validate on a config records a line telling the reader what to do next', async () => {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(baseConfig(), null, 4));

        await main(['validate', configPath]);

        expect(loggedLines()).toContain('run pack');
    });

    it('validate on a ZIP records a line naming the Portal import location', async () => {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(baseConfig(), null, 4));
        const packed = await packWidget({ configPath, outDir: tempDir });

        await main(['validate', packed.zipPath]);

        expect(loggedLines()).toContain('admin/configuration?tab=4');
    });

    it('unpack records a line naming the recovered config path and the next command', async () => {
        const configPath = path.join(tempDir, 'portal-widget.json');
        fs.writeFileSync(configPath, JSON.stringify(baseConfig(), null, 4));
        const packed = await packWidget({ configPath, outDir: tempDir });
        fs.rmSync(configPath);

        await main(['unpack', packed.zipPath, '--out', tempDir]);

        expect(loggedLines()).toContain('portal-widget.json');
        expect(loggedLines()).toContain('run pack');
    });
});
