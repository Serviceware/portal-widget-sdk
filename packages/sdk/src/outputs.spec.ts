import { describe, expect, it } from 'vitest';
import { defineConfigSchema } from './config';
import { cancelConfiguration, saveConfiguration, SecretInConfigError } from './outputs';
import type { WidgetConfig } from './types';

interface Settings {
    greeting: string;
    apiKey: string;
}

const schema = defineConfigSchema<Settings>({
    greeting: { type: 'string', default: 'Hello' },
    apiKey: { type: 'string', secret: true, default: '' }
});

function makeConfig(customConfig: Settings): WidgetConfig<Settings> {
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
        userProfile: null
    };
}

describe('saveConfiguration', () => {
    it('dispatches configurationSaved on the element with the config as detail', () => {
        const element = document.createElement('div');
        const received: CustomEvent[] = [];
        element.addEventListener('configurationSaved', e => received.push(e as CustomEvent));

        const config = makeConfig({ greeting: 'Hi', apiKey: '' });
        saveConfiguration(element, config, schema);

        expect(received).toHaveLength(1);
        expect(received[0]!.detail).toBe(config);
        expect(received[0]!.bubbles).toBe(false);
    });

    it('throws SecretInConfigError and dispatches nothing when a secret field is non-empty', () => {
        const element = document.createElement('div');
        const received: Event[] = [];
        element.addEventListener('configurationSaved', e => received.push(e));

        expect(() => saveConfiguration(element, makeConfig({ greeting: 'Hi', apiKey: 'sk-live-123' }), schema)).toThrow(
            SecretInConfigError
        );
        expect(received).toHaveLength(0);
    });

    it('names the offending fields', () => {
        try {
            saveConfiguration(document.createElement('div'), makeConfig({ greeting: 'x', apiKey: 'y' }), schema);
        } catch (error) {
            expect((error as SecretInConfigError).fields).toEqual(['apiKey']);
            return;
        }
        throw new Error('expected a throw');
    });

    it('does not guard without a schema', () => {
        const element = document.createElement('div');
        expect(() => saveConfiguration(element, makeConfig({ greeting: 'x', apiKey: 'y' }))).not.toThrow();
    });
});

describe('cancelConfiguration', () => {
    it('dispatches configurationCanceled without detail', () => {
        const element = document.createElement('div');
        const received: CustomEvent[] = [];
        element.addEventListener('configurationCanceled', e => received.push(e as CustomEvent));
        cancelConfiguration(element);
        expect(received).toHaveLength(1);
        expect(received[0]!.detail).toBeNull();
    });
});
