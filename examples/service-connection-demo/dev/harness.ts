/**
 * Minimal Portal stand-in: loads the built bundle, sets the element inputs (docs/contract.md section 2)
 * and logs what the widget dispatches. The linked Service Connection arrives the way a Portal with the
 * proxy POC delivers it: header names visible, values masked. The real key lives only in build.mjs.
 */
import { PORTAL_EVENTS, portalEventType } from '@serviceware/portal-widget-sdk/contract';
import type { PortalWidgetInputs, WidgetConfig } from '@serviceware/portal-widget-sdk';

const TAG = __WIDGET_TAG__;
const VERSION = __WIDGET_VERSION__;
/** Must match MOCK in build.mjs. */
const CONNECTION_ID = '5b0c7c0e-8f3a-4d7e-9d52-2f8f1c1d9a10';
const WIDGET_INSTANCE_ID = 'c3a1b0f2-0000-4000-8000-000000000001';

type WidgetElement = HTMLElement & PortalWidgetInputs;

const state = {
    settingsMode: false,
    token: 'dev-user-token-1',
    linked: true,
    config: makeConfig({ connection: 'weather', path: 'forecast/today?city=Bonn' })
};

function makeConfig(customConfig: Record<string, unknown>): WidgetConfig {
    return {
        id: WIDGET_INSTANCE_ID,
        routeId: 1,
        customConfig,
        customTrans: {},
        meta: [{ language: 'en', name: 'Service Connection Demo' }],
        usedVersion: {
            id: 'version-1',
            name: TAG,
            number: VERSION,
            authenticated: true,
            angularVersion: 0,
            fileName: `${TAG}-${VERSION}-full.js`,
            fileNameLight: `${TAG}-${VERSION}-light.js`
        },
        position: { desktop: { x: 0, y: 0, columns: 4, rows: 3 } },
        serviceConnectionsId: [CONNECTION_ID],
        serviceConnections: [
            {
                id: CONNECTION_ID,
                name: 'weather',
                module: 'widgets',
                url: 'https://api.weather.example/v1',
                isDefault: false,
                security: { mode: 2, headers: [{ key: 'x-api-key', value: '********' }] }
            }
        ]
    } as WidgetConfig;
}

function currentConfig(): WidgetConfig {
    return state.linked ? state.config : { ...state.config, serviceConnectionsId: [], serviceConnections: [] };
}

const tile = document.getElementById('tile') as HTMLDivElement;
const logList = document.getElementById('log') as HTMLUListElement;
let element: WidgetElement | null = null;

function log(label: string, detail: unknown): void {
    const item = document.createElement('li');
    const bold = document.createElement('b');
    bold.textContent = label;
    item.append(bold, ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    logList.prepend(item);
}

function mount(): void {
    element?.remove();
    element = document.createElement(TAG) as WidgetElement;
    element.setAttribute(TAG, '');
    element.apiUrl = `${location.origin}/mock-api`;
    element.authToken = state.token;
    element.language = 'en';
    element.isAdminMode = true;
    element.settingsMode = state.settingsMode;
    element.configuration = currentConfig();
    element.addEventListener('configurationSaved', event => {
        state.config = (event as CustomEvent<WidgetConfig>).detail;
        log('configurationSaved', state.config.customConfig);
        state.settingsMode = false;
        mount();
    });
    element.addEventListener('configurationCanceled', () => {
        log('configurationCanceled', '');
        state.settingsMode = false;
        mount();
    });
    tile.append(element);
}

for (const name of Object.values(PORTAL_EVENTS)) {
    window.addEventListener(portalEventType(name), event => log(name, (event as CustomEvent).detail));
}

// Log what actually leaves the page, so it is visible that no key is ever sent from here.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const headers = [...request.headers.entries()].map(([k, v]) => `${k}: ${k === 'authorization' ? v.slice(0, 16) + '...' : v}`);
    log('fetch', `${request.method} ${request.url}\n${headers.join('\n')}`);
    return originalFetch(request);
};

document.getElementById('settings')!.addEventListener('click', () => {
    state.settingsMode = !state.settingsMode;
    mount();
});
document.getElementById('anonymous')!.addEventListener('click', () => {
    state.token = state.token ? '' : 'dev-user-token-1';
    if (element) element.authToken = state.token;
    log('authToken', state.token ? 'set' : 'cleared (anonymous user)');
});
document.getElementById('unlink')!.addEventListener('click', () => {
    state.linked = !state.linked;
    if (element) element.configuration = currentConfig();
    log('serviceConnections', state.linked ? 'linked' : 'unlinked');
});

mount();
