/**
 * Minimal Portal stand-in: loads the built bundle, sets the element inputs (docs/contract.md section 2)
 * and logs what the widget dispatches. The linked Service Connections arrive the way a Portal with the
 * Service Connection proxy delivers them: header names visible, values masked, and `url: null` for
 * anonymous visitors. The real key lives only in build.mjs.
 */
import { PORTAL_EVENTS, portalEventType } from '@serviceware-oss/portal-widget-sdk/contract';
import type { PortalWidgetInputs, ServiceConnection, WidgetConfig } from '@serviceware-oss/portal-widget-sdk';

const TAG = __WIDGET_TAG__;
const VERSION = __WIDGET_VERSION__;
/** Must match MOCK in build.mjs. */
const CONNECTIONS: ServiceConnection[] = [
    {
        id: '5b0c7c0e-8f3a-4d7e-9d52-2f8f1c1d9a10',
        name: 'weather',
        module: 'portal',
        url: 'https://api.weather.example/v1',
        isDefault: false,
        security: { mode: 2, headers: [{ key: 'x-api-key', value: '********' }], allowAnonymous: false }
    },
    {
        id: '7d2e9f14-3b6a-4c1d-8e0f-5a9b2c4d6e81',
        name: 'public-weather',
        module: 'portal',
        url: 'https://api.weather.example/v1',
        isDefault: false,
        security: { mode: 2, headers: [{ key: 'x-api-key', value: '********' }], allowAnonymous: true }
    }
];
const WIDGET_INSTANCE_ID = 'c3a1b0f2-0000-4000-8000-000000000001';

type WidgetElement = HTMLElement & PortalWidgetInputs;

const state = {
    settingsMode: false,
    token: 'dev-user-token-1',
    linked: true,
    config: makeConfig({ connection: CONNECTIONS[0]!.id, path: 'forecast/today?city=Bonn' })
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
        serviceConnectionsId: CONNECTIONS.map(connection => connection.id)
    } as WidgetConfig;
}

/** What the Portal sends: the linked connections, with `url` hidden from anonymous visitors when mode != 0. */
function currentConfig(): WidgetConfig {
    if (!state.linked) {
        return { ...state.config, serviceConnectionsId: [], serviceConnections: [] };
    }
    const linkedIds = state.config.serviceConnectionsId ?? [];
    const serviceConnections = CONNECTIONS.filter(connection => linkedIds.includes(connection.id)).map(connection => ({
        ...connection,
        url: !state.token && connection.security?.mode !== 0 ? null : connection.url
    }));
    return { ...state.config, serviceConnections };
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
    if (element) {
        element.authToken = state.token;
        element.configuration = currentConfig();
    }
    log('authToken', state.token ? 'set' : 'cleared (anonymous user)');
});
document.getElementById('connection')!.addEventListener('click', () => {
    const current = (state.config.customConfig as { connection?: string }).connection;
    const next = CONNECTIONS.find(connection => connection.id !== current) ?? CONNECTIONS[0]!;
    state.config = { ...state.config, customConfig: { ...state.config.customConfig, connection: next.id } };
    if (element) element.configuration = currentConfig();
    log('customConfig.connection', next.name);
});
document.getElementById('unlink')!.addEventListener('click', () => {
    state.linked = !state.linked;
    if (element) element.configuration = currentConfig();
    log('serviceConnections', state.linked ? 'linked' : 'unlinked');
});

mount();
