import * as path from 'node:path';

const PORTAL_IMPORT_LOCATION = 'admin/configuration?tab=4';

export type NextActionKind = 'pack' | 'validate-config' | 'validate-zip' | 'unpack' | 'wizard-custom';

/**
 * Every kind `nextAction` handles, in dispatch order. A spec iterates this
 * list rather than naming kinds one at a time, so a command added without a
 * matching case here (and therefore without a closing next-action line)
 * fails the build instead of shipping silently.
 */
export const NEXT_ACTION_KINDS: readonly NextActionKind[] = [
    'pack',
    'validate-config',
    'validate-zip',
    'unpack',
    'wizard-custom'
];

export interface NextActionDetails {
    zipPath?: string;
    hasErrors?: boolean;
    configPath?: string;
    tagName?: string;
    fullBundlePath?: string;
    lightBundlePath?: string;
}

/**
 * The closing line every command prints. Kept in this one module so no
 * command can quietly ship without stating its next action. The wizard's
 * embed branch prints `pack`'s own message (it ends by calling `packWidget`
 * and returning that result's `nextAction`); `wizard-custom` is the one kind
 * unique to the wizard, since its custom branch stops at the config and
 * leaves building the bundles to the author.
 */
export function nextAction(kind: NextActionKind, details: NextActionDetails = {}): string {
    switch (kind) {
        case 'pack':
            return [
                `Wrote ${path.resolve(details.zipPath as string)}`,
                `Next: open ${PORTAL_IMPORT_LOCATION} in the Portal, use the split button's Import entry,`,
                'pick that ZIP, and press Upload once the prefilled dialog shows no errors.'
            ].join('\n');
        case 'validate-config':
            return details.hasErrors
                ? 'Next: fix the field(s) named above, then re-run validate.'
                : 'Next: run pack to produce the ZIP.';
        case 'validate-zip':
            return details.hasErrors
                ? 'Next: fix the field(s) named above, then re-run pack.'
                : [
                      `Next: open ${PORTAL_IMPORT_LOCATION} in the Portal, use the split button's Import entry,`,
                      'pick this ZIP, and press Upload once the prefilled dialog shows no errors.'
                  ].join('\n');
        case 'unpack':
            return [
                `Wrote ${path.resolve(details.configPath as string)}`,
                'Next: edit that file and run pack.'
            ].join('\n');
        case 'wizard-custom':
            return [
                `Wrote ${path.resolve(details.configPath as string)}`,
                `Next: build your widget with any framework into ${details.fullBundlePath} and ${details.lightBundlePath},`,
                `each a classic script that calls customElements.define('${details.tagName}', ...), then run pack.`
            ].join('\n');
        default:
            throw new Error(`Unknown nextAction kind: ${kind as string}`);
    }
}
