import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyConfigDefaults, SspWidgetConfig, writeConfig } from './config';
import { nextAction as buildNextAction } from './output';
import { packWidget } from './pack';
import { CONFIG_FILE_NAME, DEFAULT_WIDGET_VERSION } from './package-identity';
import { slugifyTag } from './slugify';
import { formatIssues, validateConfig } from './validate';

export interface WizardIo {
    ask(question: string, fallback?: string): Promise<string>;
    log(line: string): void;
}

export interface WizardResult {
    path: 'embed' | 'custom';
    configPath: string;
    zipPath?: string;
    nextAction: string;
}

const PATH_QUESTION =
    'Widget type -- "embed" (no code, a URL in a tile) or "custom" (your own bundles, any framework)? [embed]';
const NAME_QUESTION = 'Display name for the widget (shown in the Portal catalog and on the tile header)?';
const URL_QUESTION = 'URL to embed?';

/** Where the custom path expects the author's built bundles, relative to the config file. */
const CUSTOM_BUNDLE_DIR = 'bundles';

async function askRequired(io: WizardIo, question: string): Promise<string> {
    for (;;) {
        const answer = (await io.ask(question)).trim();
        if (answer) {
            return answer;
        }
        io.log('That cannot be blank -- try again.');
    }
}

function baseConfig(displayName: string): Partial<SspWidgetConfig> {
    return {
        tagName: slugifyTag(displayName),
        name: [{ language: 'en', value: displayName }],
        description: [{ language: 'en', value: displayName }],
        changes: [{ language: 'en', value: 'Initial version' }]
    };
}

/**
 * Everything but the display name and the URL is derived. `changes` and
 * `description` are derived here (the wizard's own job, not
 * `applyConfigDefaults`'s); `defaultSize`/`angularVersion`/`authenticated`/
 * `tags`/`dependencies`/`version` flow through `applyConfigDefaults`, the
 * same function `readConfig` uses, so the two entry points can never
 * disagree about what a default is.
 */
function buildEmbedConfig(displayName: string, url: string): SspWidgetConfig {
    return applyConfigDefaults({
        template: 'embed',
        ...baseConfig(displayName),
        embed: { defaultUrl: url }
    });
}

/**
 * The custom path stops at the config: the author builds the two bundles
 * with whatever toolchain they like (see docs/sdk.md for the Portal contract
 * a bundle must honour) and `pack` picks them up from the paths named here.
 * `angularVersion: 0` is the Portal's value for a non-Angular widget -- the
 * full bundle is always used; an Angular author who externalised against a
 * specific major can raise it by hand.
 */
function buildCustomConfig(displayName: string): SspWidgetConfig {
    const base = baseConfig(displayName);
    const tagName = base.tagName as string;
    return applyConfigDefaults({
        template: 'custom',
        ...base,
        angularVersion: 0,
        custom: {
            fullBundlePath: `${CUSTOM_BUNDLE_DIR}/${tagName}-${DEFAULT_WIDGET_VERSION}-full.js`,
            lightBundlePath: `${CUSTOM_BUNDLE_DIR}/${tagName}-${DEFAULT_WIDGET_VERSION}-light.js`
        }
    });
}

/**
 * Embed: two questions in, import-ready ZIP out. Custom: one question in,
 * a `template: "custom"` config out that names where the author's bundles
 * must land. Both refuse to overwrite an existing config -- it is the durable
 * source of truth, not the wizard session that wrote it.
 */
export async function runWizard(io: WizardIo, cwd: string): Promise<WizardResult> {
    const pathAnswer = (await io.ask(PATH_QUESTION)).trim().toLowerCase();
    const chosenPath: WizardResult['path'] = pathAnswer === 'custom' ? 'custom' : 'embed';

    const configPath = path.join(cwd, CONFIG_FILE_NAME);
    if (fs.existsSync(configPath)) {
        const message = `${CONFIG_FILE_NAME} already exists at ${configPath} -- edit it and run pack instead of the wizard.`;
        io.log(message);
        return { path: chosenPath, configPath, nextAction: message };
    }

    const displayName = await askRequired(io, NAME_QUESTION);

    if (chosenPath === 'custom') {
        const config = buildCustomConfig(displayName);
        writeConfig(configPath, config);

        const issues = validateConfig(config, cwd);
        if (issues.some(issue => issue.severity === 'error')) {
            const message = formatIssues(issues);
            io.log(message);
            return { path: 'custom', configPath, nextAction: message };
        }

        const message = buildNextAction('wizard-custom', {
            configPath,
            tagName: config.tagName,
            fullBundlePath: config.custom?.fullBundlePath,
            lightBundlePath: config.custom?.lightBundlePath
        });
        io.log(message);
        return { path: 'custom', configPath, nextAction: message };
    }

    const url = await askRequired(io, URL_QUESTION);

    const config = buildEmbedConfig(displayName, url);
    writeConfig(configPath, config);

    const issues = validateConfig(config, cwd);
    if (issues.some(issue => issue.severity === 'error')) {
        const message = formatIssues(issues);
        io.log(message);
        return { path: 'embed', configPath, nextAction: message };
    }

    const packed = await packWidget({ configPath, outDir: cwd });
    io.log(packed.nextAction);

    return { path: 'embed', configPath, zipPath: packed.zipPath, nextAction: packed.nextAction };
}
