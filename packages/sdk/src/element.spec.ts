import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfigSchema } from './config';
import { definePortalWidget, WidgetContext } from './element';
import type { PortalWidgetInputs, WidgetConfig } from './types';

interface Settings {
    greeting: string;
    apiKey: string;
}

const schema = defineConfigSchema<Settings>({
    greeting: { type: 'string', default: 'Hello' },
    apiKey: { type: 'string', secret: true, default: '' }
});

let tagCounter = 0;
function nextTag(): string {
    tagCounter += 1;
    return `acme-test-widget-${tagCounter}`;
}

function makeConfig(customConfig: Partial<Settings> = {}): WidgetConfig<Partial<Settings>> {
    return {
        id: 'rw-1',
        routeId: 1,
        customConfig,
        meta: [{ language: 'en', name: 'Test' }],
        usedVersion: {
            id: 'v',
            name: 'acme',
            number: '2.3.4',
            authenticated: false,
            angularVersion: 0,
            fileName: 'f.js',
            fileNameLight: 'l.js'
        },
        position: {},
        userProfile: null
    };
}

type Inputs = HTMLElement & Partial<PortalWidgetInputs<Partial<Settings>>>;

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[data-portal-widget]').forEach(s => s.remove());
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('definePortalWidget', () => {
    it('collects properties set before connect and calls render once with them', async () => {
        const tag = nextTag();
        const render = vi.fn();
        definePortalWidget<Partial<Settings>>({ tag, configSchema: schema, render });

        const element = document.createElement(tag) as Inputs;
        element.language = 'de-DE';
        element.configuration = makeConfig({ greeting: 'Servus' });
        element.apiUrl = 'https://portal.example.com/api';
        document.body.appendChild(element);

        expect(render).not.toHaveBeenCalled();
        await flush();
        expect(render).toHaveBeenCalledTimes(1);

        const ctx = render.mock.calls[0]![0] as WidgetContext<Partial<Settings>>;
        expect(ctx.element).toBe(element);
        expect(ctx.root).toBe(element.shadowRoot);
        expect(ctx.inputs.language).toBe('de-DE');
        expect(ctx.inputs.configuration.customConfig).toEqual({ greeting: 'Servus' });
    });

    it('waits for configuration when the Portal sets it after connect', async () => {
        const tag = nextTag();
        const render = vi.fn();
        definePortalWidget({ tag, render });

        const element = document.createElement(tag) as Inputs;
        document.body.appendChild(element);
        await flush();
        expect(render).not.toHaveBeenCalled();

        element.configuration = makeConfig();
        await flush();
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('batches later input changes into one onInputsChange call per microtask', async () => {
        const tag = nextTag();
        const onInputsChange = vi.fn();
        definePortalWidget({ tag, render: () => undefined, onInputsChange });

        const element = document.createElement(tag) as Inputs;
        element.configuration = makeConfig();
        document.body.appendChild(element);
        await flush();

        element.settingsMode = true;
        element.portalScreenLayout = 'mobile';
        expect(onInputsChange).not.toHaveBeenCalled();
        await flush();

        expect(onInputsChange).toHaveBeenCalledTimes(1);
        expect(onInputsChange.mock.calls[0]![0]).toEqual({ settingsMode: true, portalScreenLayout: 'mobile' });
        expect((onInputsChange.mock.calls[0]![1] as WidgetContext<unknown>).inputs.portalScreenLayout).toBe('mobile');
    });

    it('reflects hidden onto the attribute', async () => {
        const tag = nextTag();
        definePortalWidget({ tag, render: () => undefined });
        const element = document.createElement(tag) as Inputs;
        element.hidden = true;
        expect(element.hasAttribute('hidden')).toBe(true);
        element.hidden = false;
        expect(element.hasAttribute('hidden')).toBe(false);
    });

    it('light mode injects one document stylesheet per tag with the probe rule inside @layer widgets', async () => {
        const tag = nextTag();
        definePortalWidget({ tag, cssMode: 'light', styles: `@layer widgets { [${tag}] .x { color: red; } }`, render: () => undefined });

        for (let i = 0; i < 2; i += 1) {
            const element = document.createElement(tag) as Inputs;
            element.configuration = makeConfig();
            document.body.appendChild(element);
        }
        await flush();

        const styles = document.head.querySelectorAll(`style[data-portal-widget="${tag}"]`);
        expect(styles).toHaveLength(1);
        expect(styles[0]!.textContent).toContain(`@layer widgets { [${tag}] {} }`);
        expect(styles[0]!.textContent).toContain('.x { color: red; }');
        expect(document.body.querySelector(tag)!.shadowRoot).toBeNull();
    });

    it('shadow mode injects the styles into the shadow root', async () => {
        const tag = nextTag();
        definePortalWidget({ tag, styles: '.y { color: blue; }', render: ctx => void (ctx.root.innerHTML += '<p>hi</p>') });
        const element = document.createElement(tag) as Inputs;
        element.configuration = makeConfig();
        document.body.appendChild(element);
        await flush();

        expect(element.shadowRoot!.querySelector('style')!.textContent).toContain('.y { color: blue; }');
        expect(element.shadowRoot!.querySelector('p')!.textContent).toBe('hi');
    });

    it('save() clones the configuration, replaces customConfig and dispatches configurationSaved', async () => {
        const tag = nextTag();
        let ctx!: WidgetContext<Partial<Settings>>;
        definePortalWidget<Partial<Settings>>({ tag, configSchema: schema, render: c => void (ctx = c) });

        const element = document.createElement(tag) as Inputs;
        const original = makeConfig({ greeting: 'old' });
        element.configuration = original;
        document.body.appendChild(element);
        await flush();

        const saved: CustomEvent[] = [];
        element.addEventListener('configurationSaved', e => saved.push(e as CustomEvent));
        ctx.save({ greeting: 'new', apiKey: '' });

        expect(saved).toHaveLength(1);
        expect(saved[0]!.detail).not.toBe(original);
        expect(saved[0]!.detail.customConfig).toEqual({ greeting: 'new', apiKey: '' });
        expect(saved[0]!.detail.id).toBe('rw-1');
        expect(original.customConfig).toEqual({ greeting: 'old' });

        expect(() => ctx.save({ greeting: 'x', apiKey: 'leak' })).toThrow(/secret/);
        expect(saved).toHaveLength(1);
    });

    it('cancel() and openSettings() dispatch the contract events', async () => {
        const tag = nextTag();
        let ctx!: WidgetContext<Partial<Settings>>;
        definePortalWidget<Partial<Settings>>({ tag, render: c => void (ctx = c) });

        const element = document.createElement(tag) as Inputs;
        element.configuration = makeConfig();
        document.body.appendChild(element);
        await flush();

        const canceled: Event[] = [];
        element.addEventListener('configurationCanceled', e => canceled.push(e));
        ctx.cancel();
        expect(canceled).toHaveLength(1);

        const modal: CustomEvent[] = [];
        window.addEventListener('eventShowConfigModalSSPEvent', e => modal.push(e as CustomEvent), { once: true });
        ctx.openSettings();
        expect(modal).toHaveLength(1);
        expect(modal[0]!.detail).toEqual({ ...makeConfig(), handled: false });
    });

    it('onResize subscribes for this instance and is cleaned up on disconnect together with render cleanup', async () => {
        const tag = nextTag();
        const cleanup = vi.fn();
        let ctx!: WidgetContext<Partial<Settings>>;
        definePortalWidget<Partial<Settings>>({
            tag,
            render: c => {
                ctx = c;
                return cleanup;
            }
        });

        const element = document.createElement(tag) as Inputs;
        element.configuration = makeConfig();
        document.body.appendChild(element);
        await flush();

        const sizes: unknown[] = [];
        ctx.onResize(size => sizes.push(size));
        window.dispatchEvent(
            new CustomEvent('eventWidgetResizedSSPEvent', { detail: { widgetId: 'rw-1', newWidth: 300, newHeight: 200 } })
        );
        expect(sizes).toEqual([{ width: 300, height: 200 }]);

        element.remove();
        expect(cleanup).toHaveBeenCalledTimes(1);
        window.dispatchEvent(
            new CustomEvent('eventWidgetResizedSSPEvent', { detail: { widgetId: 'rw-1', newWidth: 1, newHeight: 1 } })
        );
        expect(sizes).toHaveLength(1);
    });

    it('re-renders after a disconnect/reconnect (grid drag) with a clean root', async () => {
        const tag = nextTag();
        const render = vi.fn((ctx: WidgetContext<unknown>) => {
            ctx.root.appendChild(document.createElement('p'));
        });
        definePortalWidget({ tag, render });

        const element = document.createElement(tag) as Inputs;
        element.configuration = makeConfig();
        document.body.appendChild(element);
        await flush();
        element.remove();
        document.body.appendChild(element);
        await flush();

        expect(render).toHaveBeenCalledTimes(2);
        expect(element.shadowRoot!.querySelectorAll('p')).toHaveLength(1);
        expect(element.shadowRoot!.querySelectorAll('style')).toHaveLength(1);
    });

    it('loadTranslations fetches the contract path with the bearer token and the used version', async () => {
        const tag = nextTag();
        let ctx!: WidgetContext<Partial<Settings>>;
        definePortalWidget<Partial<Settings>>({ tag, render: c => void (ctx = c) });

        const requests: Request[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: Request) => {
                requests.push(input);
                return new Response(JSON.stringify({ hello: 'Hallo' }), { status: 200 });
            })
        );

        const element = document.createElement(tag) as Inputs;
        element.configuration = makeConfig();
        element.apiUrl = 'https://portal.example.com/api-gateway';
        element.authToken = 'tok';
        element.language = 'de-DE';
        document.body.appendChild(element);
        await flush();

        await expect(ctx.loadTranslations()).resolves.toEqual({ hello: 'Hallo' });
        expect(requests[0]!.url).toBe(`https://portal.example.com/api-gateway/storage/v1/widgets/${tag}/2.3.4/translations/de-DE`);
        expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok');

        await ctx.loadTranslations('en');
        expect(requests[1]!.url.endsWith('/translations/en')).toBe(true);
    });
});
