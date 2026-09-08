import { describe, expect, it } from 'vitest';
import { debugConfig, defineConfigSchema, REDACTED, withDefaults } from './config';
import type { WidgetConfig } from './types';

interface Settings {
    greeting: string;
    count: number;
    enabled: boolean;
    apiKey: string;
}

const schema = defineConfigSchema<Settings>({
    greeting: { type: 'string', default: 'Hello' },
    count: { type: 'number', default: 3 },
    enabled: { type: 'boolean', default: true },
    apiKey: { type: 'string', secret: true, default: '' }
});

function makeConfig(customConfig: Partial<Settings>): WidgetConfig<Partial<Settings>> {
    return {
        id: 'rw-1',
        routeId: 1,
        customConfig,
        meta: [{ language: 'en', name: 'Test' }],
        usedVersion: {
            id: 'v',
            name: 'acme-test',
            number: '1.0.0',
            authenticated: false,
            angularVersion: 0,
            fileName: 'f.js',
            fileNameLight: 'l.js'
        },
        position: {},
        userProfile: { id: 'u1', email: 'someone@example.com' },
        serviceConnections: [
            {
                id: 'sc1',
                name: 'Weather',
                module: 'custom',
                url: 'https://weather.example',
                isDefault: true,
                security: { mode: 2, headers: [{ key: 'x-api-key', value: 'super-secret' }] }
            }
        ]
    };
}

describe('withDefaults', () => {
    it('fills missing fields from the schema defaults and keeps present ones', () => {
        expect(withDefaults(makeConfig({ count: 0, enabled: false }), schema)).toEqual({
            greeting: 'Hello',
            count: 0,
            enabled: false,
            apiKey: ''
        });
    });

    it('tolerates a missing config entirely', () => {
        expect(withDefaults(undefined, schema)).toEqual({ greeting: 'Hello', count: 3, enabled: true, apiKey: '' });
    });
});

describe('debugConfig', () => {
    it('redacts user profile, service connection security and secret fields without mutating the input', () => {
        const config = makeConfig({ greeting: 'Hi', apiKey: 'sk-123' });
        const redacted = debugConfig(config, schema) as WidgetConfig<Settings> & { serviceConnections: unknown[] };

        expect(redacted.userProfile).toBe(REDACTED);
        expect(redacted.customConfig.apiKey).toBe(REDACTED);
        expect(redacted.customConfig.greeting).toBe('Hi');
        expect(redacted.serviceConnections[0]).toMatchObject({ id: 'sc1', security: REDACTED });

        expect(config.userProfile).toEqual({ id: 'u1', email: 'someone@example.com' });
        expect(config.customConfig.apiKey).toBe('sk-123');
        expect(JSON.stringify(redacted)).not.toContain('super-secret');
        expect(JSON.stringify(redacted)).not.toContain('someone@example.com');
    });

    it('leaves a null user profile alone', () => {
        const config = { ...makeConfig({}), userProfile: null };
        expect((debugConfig(config) as WidgetConfig).userProfile).toBeNull();
    });
});
