import { SspWidgetConfig } from './config';

export const PRELUDE_PREFIX = 'globalThis.__SSP_WIDGET_DEF__=';

interface PreludePayload {
    tag: string;
    template: string;
    config?: { defaultUrl?: string };
}

/**
 * Reference shape proven in the live Portal (Phase 1): one statement,
 * JSON-serialized object literal, terminated by `;` and a newline.
 */
export function buildPrelude(config: SspWidgetConfig): string {
    const payload: PreludePayload = {
        tag: config.tagName,
        template: config.template,
        ...(config.embed ? { config: { defaultUrl: config.embed.defaultUrl } } : {})
    };
    return `${PRELUDE_PREFIX}${JSON.stringify(payload)};\n`;
}

/**
 * Concatenates prelude bytes ahead of the untouched bundle bytes. Never a
 * string replacement inside the bundle (D-11).
 */
export function prependPrelude(bundleBytes: Uint8Array, config: SspWidgetConfig): Uint8Array {
    const preludeBytes = Buffer.from(buildPrelude(config), 'utf8');
    const result = new Uint8Array(preludeBytes.length + bundleBytes.length);
    result.set(preludeBytes, 0);
    result.set(bundleBytes, preludeBytes.length);
    return result;
}

export function extractPreludeTag(bundleBytes: Uint8Array): string | null {
    const head = Buffer.from(bundleBytes.subarray(0, 512)).toString('utf8');
    const firstLine = head.split('\n')[0];
    if (!firstLine.startsWith(PRELUDE_PREFIX)) {
        return null;
    }

    const jsonText = firstLine.slice(PRELUDE_PREFIX.length).replace(/;$/, '');
    try {
        const parsed = JSON.parse(jsonText) as { tag?: unknown };
        return typeof parsed.tag === 'string' ? parsed.tag : null;
    } catch {
        return null;
    }
}
