/**
 * Element outputs: the two DOM events the Portal listens for on the widget
 * element (docs/contract.md section 3), plus the secret guard from docs/security.md section 3.
 */
import { ELEMENT_OUTPUTS } from './contract';
import type { ConfigSchema, WidgetConfig } from './types';

export class SecretInConfigError extends Error {
    readonly fields: readonly string[];

    constructor(fields: readonly string[]) {
        super(
            `Refusing to save configuration: field(s) ${fields.map(f => `"${f}"`).join(', ')} are marked secret but not empty. ` +
                'customConfig is visible to every visitor of the page; keep secrets in a Portal Service Connection (docs/security.md).'
        );
        this.name = 'SecretInConfigError';
        this.fields = fields;
    }
}

function isEmpty(value: unknown): boolean {
    if (value === undefined || value === null || value === '') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    if (typeof value === 'object') {
        return Object.keys(value as object).length === 0;
    }
    return false;
}

/** Names of `secret: true` schema fields whose value in `customConfig` is not empty. */
export function findNonEmptySecrets<T>(customConfig: T, schema?: ConfigSchema<T>): string[] {
    if (!schema || !customConfig || typeof customConfig !== 'object') {
        return [];
    }
    const config = customConfig as Record<string, unknown>;
    return (Object.keys(schema) as (keyof T & string)[]).filter(key => schema[key].secret === true && !isEmpty(config[key]));
}

/**
 * Tells the Portal to persist `config` and close the settings dialog.
 * Throws `SecretInConfigError` before dispatching anything if `schema` marks a
 * non-empty field as secret.
 */
export function saveConfiguration<T>(element: HTMLElement, config: WidgetConfig<T>, schema?: ConfigSchema<T>): void {
    const leaked = findNonEmptySecrets(config.customConfig, schema);
    if (leaked.length > 0) {
        throw new SecretInConfigError(leaked);
    }
    element.dispatchEvent(new CustomEvent(ELEMENT_OUTPUTS.configurationSaved, { detail: config }));
}

/** Tells the Portal to close the settings dialog without saving. */
export function cancelConfiguration(element: HTMLElement): void {
    element.dispatchEvent(new CustomEvent(ELEMENT_OUTPUTS.configurationCanceled));
}
