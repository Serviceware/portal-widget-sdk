/**
 * Minimal stand-in for the Portal shell, for developing the widget without a Portal:
 * loads the built bundle as a classic script, sets every element input from docs/contract.md
 * section 2, listens for the element outputs (section 3) and the window events (section 4),
 * mocks toasts, the settings dialog, the skeleton and resize events, and runs a copy of the
 * CSS compliance probe. Copied from examples/serviceware-logo-three/dev (minus the canvas capture).
 */
import { ELEMENT_OUTPUTS, PORTAL_EVENTS, PortalEventName, portalEventType } from '@serviceware/portal-widget-sdk/contract';
import type {
    LanguageInfo,
    PortalWidgetInputs,
    ResizeEventArgs,
    ScreenLayout,
    ToastOptions,
    WidgetConfig
} from '@serviceware/portal-widget-sdk';

const TAG = __WIDGET_TAG__;
const VERSION = __WIDGET_VERSION__;
const WIDGET_ID = 'route-widget-1';
const HOST_TAG = 'ssp-portal-widget';

type WidgetElement = HTMLElement & PortalWidgetInputs;

const state = {
    language: 'en',
    layout: 'desktop' as ScreenLayout,
    isAdminMode: true,
    editionMode: false,
    hidden: false,
    token: 'dev-token-1',
    tokenCounter: 1,
    config: makeConfig()
};

const availableLanguages: LanguageInfo[] = [
    { code: 'en', nativeName: 'English', id: 1 },
    { code: 'de-DE', nativeName: 'Deutsch', id: 2 },
    { code: 'fr', nativeName: 'Français', id: 3 }
];

function byId<E extends HTMLElement>(id: string): E {
    return document.getElementById(id) as E;
}

const tile = byId<HTMLDivElement>('tile');
const logList = byId<HTMLUListElement>('log');
const toasts = byId<HTMLDivElement>('toasts');
const dialog = byId<HTMLDialogElement>('dialog');
const dialogBody = byId<HTMLDivElement>('dialog-body');

let mainElement: WidgetElement | null = null;
let dialogElement: WidgetElement | null = null;

function makeConfig(customConfig: Record<string, unknown> = {}): WidgetConfig {
    return {
        id: WIDGET_ID,
        routeId: 1,
        customConfig,
        customTrans: {},
        meta: [{ language: 'en', name: 'React Live Counter' }],
        usedVersion: {
            id: 'version-1',
            name: TAG,
            number: VERSION,
            authenticated: false,
            angularVersion: 0,
            fileName: `${TAG}-${VERSION}-full.js`,
            fileNameLight: `${TAG}-${VERSION}-light.js`
        },
        position: { desktop: { x: 0, y: 0, columns: 3, rows: 2 } },
        userProfile: { id: 'user-1', userName: 'dev', firstName: 'Dev', lastName: 'User', language: 'en' }
    };
}

function log(kind: string, detail?: unknown, isError = false): void {
    const item = document.createElement('li');
    if (isError) {
        item.className = 'error';
    }
    const label = document.createElement('b');
    label.textContent = `${new Date().toLocaleTimeString()} ${kind}`;
    item.append(label);
    if (detail !== undefined) {
        item.append(`\n${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 1)}`);
    }
    logList.prepend(item);
    while (logList.children.length > 200) {
        logList.lastElementChild?.remove();
    }
}

/** Sets every property the Portal sets, in the contract's order. */
function applyInputs(element: WidgetElement, settingsMode: boolean, configuration: WidgetConfig): void {
    element.configuration = configuration;
    element.authToken = state.token;
    element.apiUrl = `${location.origin}/mock-api`;
    element.language = state.language;
    element.targetLanguage = state.language;
    element.settingsLanguage = state.language;
    element.availableLanguages = availableLanguages;
    element.isAdminMode = state.isAdminMode;
    element.settingsMode = settingsMode;
    element.portalEditionMode = state.editionMode;
    element.portalScreenLayout = state.layout;
    element.showSettingsButton = state.isAdminMode && !state.editionMode && !settingsMode;
    element.openSettingsEvent = state.isAdminMode;
    element.hidden = state.hidden;
}

function createHost(): HTMLElement {
    const host = document.createElement(HOST_TAG);
    host.setAttribute(TAG, '');
    return host;
}

function mountMain(): void {
    const host = createHost();
    mainElement = document.createElement(TAG) as WidgetElement;
    host.appendChild(mainElement);
    tile.replaceChildren(host);
    // The Portal sets properties around connect; setting them after append exercises that path.
    applyInputs(mainElement, false, state.config);
    log('mounted', `<${TAG}> inside <${HOST_TAG} ${TAG}>`);
    setTimeout(complianceProbe, 1500);
}

function showToast(message: ToastOptions): void {
    const defaults: Record<string, number> = { success: 5000, info: 5000, warn: 4000, error: 0 };
    const toast = document.createElement('div');
    toast.className = `toast ${message.severity}`;
    const title = document.createElement('strong');
    title.textContent = message.summary ?? message.severity;
    const body = document.createElement('span');
    body.textContent = message.detail;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'x';
    close.addEventListener('click', () => toast.remove());
    toast.append(title, body, close);
    toasts.append(toast);
    const life = message.life ?? defaults[message.severity] ?? 5000;
    if (!message.sticky && life > 0) {
        setTimeout(() => toast.remove(), life);
    }
}

function openSettingsDialog(detail: Record<string, unknown>): void {
    const configuration = structuredClone(detail) as unknown as WidgetConfig & { handled?: boolean };
    delete configuration.handled;

    const host = createHost();
    dialogElement = document.createElement(TAG) as WidgetElement;
    // The dialog instance gets its properties before connect: the other ordering the SDK must handle.
    applyInputs(dialogElement, true, configuration);
    dialogElement.addEventListener(ELEMENT_OUTPUTS.configurationSaved, event => {
        const saved = (event as CustomEvent<WidgetConfig>).detail;
        log(ELEMENT_OUTPUTS.configurationSaved, saved.customConfig);
        state.config = structuredClone(saved);
        if (mainElement) {
            mainElement.configuration = state.config;
        }
        closeDialog();
    });
    dialogElement.addEventListener(ELEMENT_OUTPUTS.configurationCanceled, () => {
        log(ELEMENT_OUTPUTS.configurationCanceled);
        closeDialog();
    });
    host.appendChild(dialogElement);
    dialogBody.replaceChildren(host);
    dialog.showModal();
}

function closeDialog(): void {
    dialog.close();
    dialogBody.replaceChildren();
    dialogElement = null;
}

dialog.addEventListener('close', () => {
    dialogBody.replaceChildren();
    dialogElement = null;
});

function listen(name: PortalEventName, handler: (detail: Record<string, unknown>) => void): void {
    window.addEventListener(portalEventType(name), event => {
        const detail = ((event as CustomEvent).detail ?? {}) as Record<string, unknown>;
        log(name, detail);
        handler(detail);
    });
}

listen(PORTAL_EVENTS.showToast, detail => showToast(detail.message as ToastOptions));
listen(PORTAL_EVENTS.showConfigModal, detail => openSettingsDialog(detail));
listen(PORTAL_EVENTS.navigateRoute, detail => {
    const query = detail.queryParams ? `?${new URLSearchParams(detail.queryParams as Record<string, string>)}` : '';
    showToast({ severity: 'info', detail: `Portal would navigate to ${String(detail.route)}${query}`, summary: 'navigate' });
});
listen(PORTAL_EVENTS.loadWidgetSkeleton, detail => {
    if (detail.widgetId === WIDGET_ID) {
        tile.classList.add('skeleton');
    }
});
listen(PORTAL_EVENTS.stopWidgetSkeleton, detail => {
    if (detail.widgetId === WIDGET_ID) {
        tile.classList.remove('skeleton');
    }
});

function dispatchResize(): void {
    const detail: ResizeEventArgs = { widgetId: WIDGET_ID, newWidth: tile.clientWidth, newHeight: tile.clientHeight };
    window.dispatchEvent(new CustomEvent(portalEventType(PORTAL_EVENTS.widgetResized), { detail }));
    log(`${PORTAL_EVENTS.widgetResized} (Portal -> widget)`, detail);
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(dispatchResize, 150);
}).observe(tile);

function forEachInstance(fn: (element: WidgetElement) => void): void {
    if (mainElement) {
        fn(mainElement);
    }
    if (dialogElement) {
        fn(dialogElement);
    }
}

function refreshDerivedInputs(): void {
    forEachInstance(element => {
        element.isAdminMode = state.isAdminMode;
        element.openSettingsEvent = state.isAdminMode;
        element.portalEditionMode = state.editionMode;
        element.showSettingsButton = state.isAdminMode && !state.editionMode && !element.settingsMode;
    });
}

byId<HTMLSelectElement>('language').addEventListener('change', event => {
    state.language = (event.target as HTMLSelectElement).value;
    forEachInstance(element => {
        element.language = state.language;
        element.targetLanguage = state.language;
        element.settingsLanguage = state.language;
    });
});
byId<HTMLSelectElement>('layout').addEventListener('change', event => {
    state.layout = (event.target as HTMLSelectElement).value as ScreenLayout;
    forEachInstance(element => void (element.portalScreenLayout = state.layout));
});
byId<HTMLInputElement>('admin').addEventListener('change', event => {
    state.isAdminMode = (event.target as HTMLInputElement).checked;
    refreshDerivedInputs();
});
byId<HTMLInputElement>('edition').addEventListener('change', event => {
    state.editionMode = (event.target as HTMLInputElement).checked;
    refreshDerivedInputs();
});
byId<HTMLInputElement>('hidden').addEventListener('change', event => {
    state.hidden = (event.target as HTMLInputElement).checked;
    if (mainElement) {
        mainElement.hidden = state.hidden;
    }
});
byId<HTMLButtonElement>('resize').addEventListener('click', dispatchResize);
byId<HTMLButtonElement>('reconfig').addEventListener('click', () => {
    state.config = structuredClone(state.config);
    if (mainElement) {
        mainElement.configuration = state.config;
    }
    log('configuration re-set (new object, same content)');
});
byId<HTMLButtonElement>('token').addEventListener('click', () => {
    state.tokenCounter += 1;
    state.token = `dev-token-${state.tokenCounter}`;
    forEachInstance(element => void (element.authToken = state.token));
    log('authToken renewed');
});
byId<HTMLButtonElement>('reattach').addEventListener('click', () => {
    if (!mainElement) {
        return;
    }
    const host = mainElement.parentElement as HTMLElement;
    const element = mainElement;
    host.removeChild(element);
    log('detached; re-attaching on next frame');
    requestAnimationFrame(() => {
        host.appendChild(element);
        log('re-attached');
    });
});
byId<HTMLButtonElement>('probe').addEventListener('click', complianceProbe);

/**
 * Copy of the Portal's CSS compliance probe (docs/contract.md section 7): the host wrapper must still
 * carry `[<tag>]`, some rule in document.styleSheets must select `[<tag>]`, and that rule must live in
 * `@layer widgets`. Also reports `[<tag>]` rules outside the layer, which would outrank the Portal.
 */
function complianceProbe(): void {
    const hostOk = document.querySelector(`${HOST_TAG}[${TAG}]`) !== null;
    let scopedInWidgetsLayer = false;
    const outsideLayer: string[] = [];

    const walk = (rules: CSSRuleList, layer: string | null): void => {
        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSLayerBlockRule) {
                walk(rule.cssRules, layer ?? rule.name.split('.')[0] ?? rule.name);
            } else if (rule instanceof CSSStyleRule) {
                if (rule.selectorText.includes(`[${TAG}]`)) {
                    if (layer === 'widgets') {
                        scopedInWidgetsLayer = true;
                    } else {
                        outsideLayer.push(rule.selectorText);
                    }
                }
            } else if ('cssRules' in rule) {
                walk((rule as CSSGroupingRule).cssRules, layer);
            }
        }
    };
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            walk(sheet.cssRules, null);
        } catch {
            // cross-origin sheet, not ours
        }
    }

    const usesShadow = Boolean(mainElement?.shadowRoot);
    const problems = [
        hostOk ? null : 'host_attribute_mismatch',
        scopedInWidgetsLayer ? null : 'missing_css_scope_attribute',
        outsideLayer.length ? 'css_layer_mismatch' : null
    ].filter(Boolean);

    log(
        `[Widget Compliance] ${problems.length ? problems.join(', ') : 'pass'}`,
        {
            shadowRoot: usesShadow,
            rulesOutsideWidgetsLayer: outsideLayer,
            note: usesShadow && !scopedInWidgetsLayer ? 'Shadow mode: the real probe warns today until the Portal-side change lands (docs/css-isolation.md section 5).' : undefined
        },
        problems.length > 0
    );
}

const script = document.createElement('script');
script.src = `/bundles/${TAG}-${VERSION}-full.js`;
script.addEventListener('load', mountMain);
script.addEventListener('error', () => log('bundle failed to load', script.src, true));
document.head.appendChild(script);
