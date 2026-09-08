import * as fs from 'node:fs';
import { DEFAULT_WIDGET_VERSION } from './package-identity';

export interface MultilanguageValue {
    language: string;
    value: string;
    nativeName?: string;
}

/**
 * `portal-widget.json` -- the source of truth (D-04). Written by the wizard or
 * the scaffold, read by `pack`. `template: 'unknown'` is written only by
 * `unpack` when a ZIP's bundle carries no prelude to compare against.
 * `template: 'custom'` is the scaffold path (Phase 3): its bundles are
 * build-time tag-baked (no prelude), and its bundle bytes come from the
 * `custom` member's paths rather than the CLI's own checked-in assets.
 */
export interface SspWidgetConfig {
    template: 'embed' | 'custom' | 'unknown';
    tagName: string;
    version: string;
    name: MultilanguageValue[];
    description: MultilanguageValue[];
    changes: MultilanguageValue[];
    tags: string[];
    defaultSize: { columns: number; rows: number };
    angularVersion: number;
    authenticated: boolean;
    dependencies: { name: string; dependency: string }[];
    embed?: { defaultUrl: string };
    custom?: { fullBundlePath: string; lightBundlePath: string };
    logo?: string;
    languageFiles?: string[];
}

export function readConfig(filePath: string): SspWidgetConfig {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Could not read config file at ${filePath}: ${(error as Error).message}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Malformed JSON in config file ${filePath}: ${(error as Error).message}`);
    }

    return applyConfigDefaults(parsed as Partial<SspWidgetConfig>);
}

export function writeConfig(filePath: string, config: SspWidgetConfig): void {
    fs.writeFileSync(filePath, `${JSON.stringify(config, null, 4)}\n`, 'utf8');
}

/**
 * Fills the D-07 derivation defaults. Shared by `readConfig` and by the
 * wizard (plan 03), so the derived values can never diverge between the two
 * entry points.
 */
export function applyConfigDefaults(partial: Partial<SspWidgetConfig>): SspWidgetConfig {
    return {
        template: partial.template ?? 'embed',
        tagName: partial.tagName ?? '',
        version: partial.version ?? DEFAULT_WIDGET_VERSION,
        name: partial.name ?? [],
        description: partial.description ?? [],
        changes: partial.changes ?? [],
        tags: partial.tags ?? [],
        defaultSize: partial.defaultSize ?? { columns: 4, rows: 3 },
        angularVersion: partial.angularVersion ?? 22,
        authenticated: partial.authenticated ?? false,
        dependencies: partial.dependencies ?? [],
        ...(partial.embed !== undefined ? { embed: partial.embed } : {}),
        ...(partial.custom !== undefined ? { custom: partial.custom } : {}),
        ...(partial.logo !== undefined ? { logo: partial.logo } : {}),
        ...(partial.languageFiles !== undefined ? { languageFiles: partial.languageFiles } : {})
    };
}
