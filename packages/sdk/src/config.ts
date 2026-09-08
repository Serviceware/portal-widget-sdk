/**
 * Config schema helpers (docs/sdk.md section 6).
 */
import type { ConfigSchema, WidgetConfig } from './types';

export const REDACTED = '[redacted]';

/** Identity helper that pins the inferred `T` so `withDefaults`/`save` stay typed. */
export function defineConfigSchema<T>(schema: ConfigSchema<T>): ConfigSchema<T> {
    return schema;
}

/** `customConfig` with every schema field present, missing ones filled from `default`. */
export function withDefaults<T>(config: WidgetConfig<Partial<T>> | undefined, schema: ConfigSchema<T>): T {
    const custom = (config?.customConfig ?? {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(schema) as (keyof T & string)[]) {
        const value = custom[key];
        result[key] = value === undefined ? schema[key].default : value;
    }
    return result as T;
}

function deepClone<V>(value: V): V {
    return JSON.parse(JSON.stringify(value)) as V;
}

/**
 * Redacted copy of a `WidgetConfig`, safe to log: `userProfile`,
 * `serviceConnections[].security`, any `authToken` property and every schema
 * field marked `secret` are replaced by `"[redacted]"`.
 */
export function debugConfig<T>(config: WidgetConfig<T>, schema?: ConfigSchema<T>): unknown {
    const clone = deepClone(config) as unknown as Record<string, unknown>;

    if (clone.userProfile !== undefined && clone.userProfile !== null) {
        clone.userProfile = REDACTED;
    }
    if ('authToken' in clone) {
        clone.authToken = REDACTED;
    }
    if (Array.isArray(clone.serviceConnections)) {
        clone.serviceConnections = clone.serviceConnections.map(connection =>
            connection && typeof connection === 'object' && 'security' in connection
                ? { ...(connection as Record<string, unknown>), security: REDACTED }
                : connection
        );
    }

    const custom = clone.customConfig;
    if (schema && custom && typeof custom === 'object') {
        const customRecord = custom as Record<string, unknown>;
        for (const key of Object.keys(schema) as (keyof T & string)[]) {
            if (schema[key].secret && key in customRecord) {
                customRecord[key] = REDACTED;
            }
        }
    }

    return clone;
}
