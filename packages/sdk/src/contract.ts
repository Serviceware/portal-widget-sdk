/**
 * Portal ↔ widget contract constants.
 *
 * Source of truth: docs/contract.md. These literals mirror the Portal's own
 * `Events` enum and `EventManager` suffix; a spec in SSP_Portal asserts they
 * stay equal. Do not rename without a coordinated Portal change.
 */

/** Suffix the Portal appends to every window event type. */
export const PORTAL_EVENT_SUFFIX = 'SSPEvent' as const;

/** Window event names (without suffix). */
export const PORTAL_EVENTS = {
    /** widget → Portal: render a toast in the shell */
    showToast: 'eventShowToast',
    /** widget → Portal: open the settings dialog for a widget instance */
    showConfigModal: 'eventShowConfigModal',
    /** widget → Portal: navigate inside the Portal */
    navigateRoute: 'eventNavigateRoute',
    /** widget → Portal: show a loading skeleton over a widget instance */
    loadWidgetSkeleton: 'eventLoadWidgetSkeleton',
    /** widget → Portal: hide the loading skeleton */
    stopWidgetSkeleton: 'eventStopWidgetSkeleton',
    /** Portal → widget: a widget instance was resized */
    widgetResized: 'eventWidgetResized'
} as const;

export type PortalEventName = (typeof PORTAL_EVENTS)[keyof typeof PORTAL_EVENTS];

/** Full `CustomEvent.type` for a Portal event name. */
export function portalEventType(name: PortalEventName): `${PortalEventName}${typeof PORTAL_EVENT_SUFFIX}` {
    return `${name}${PORTAL_EVENT_SUFFIX}`;
}

/** DOM events the Portal listens for on the widget element. */
export const ELEMENT_OUTPUTS = {
    configurationSaved: 'configurationSaved',
    configurationCanceled: 'configurationCanceled'
} as const;

/** Properties the Portal sets on the widget element. */
export const ELEMENT_INPUTS = [
    'configuration',
    'authToken',
    'apiUrl',
    'language',
    'targetLanguage',
    'settingsLanguage',
    'availableLanguages',
    'isAdminMode',
    'settingsMode',
    'portalEditionMode',
    'portalScreenLayout',
    'showSettingsButton',
    'openSettingsEvent',
    'hidden'
] as const;

export type ElementInputName = (typeof ELEMENT_INPUTS)[number];

/** Cascade layer every widget stylesheet must live in (light-DOM mode). */
export const WIDGETS_CSS_LAYER = 'widgets' as const;

/** Portal cascade layer order, for documentation and lint messages. */
export const PORTAL_LAYER_ORDER = [
    'codeblue-legacy',
    'codeblue3',
    'portal-base',
    'primeng',
    'portal-overrides',
    'widgets',
    'app-overrides'
] as const;

/** Default toast lifetimes in ms used by the Portal's own widgets. 0 = sticky. */
export const TOAST_DEFAULT_LIFE = {
    success: 5000,
    info: 5000,
    warn: 4000,
    error: 0
} as const;

/** Relative API path for widget translations. */
export function translationsPath(tag: string, version: string, language: string): string {
    return `storage/v1/widgets/${tag}/${version}/translations/${language}`;
}

/**
 * Version the Portal backend assigns to every private widget. Private bundle
 * file names must use it or the storage service cannot resolve them
 * (docs/backend-findings.md §3).
 */
export const PRIVATE_WIDGET_VERSION = '1.0.0' as const;

/** Bundle file name convention shared with the Portal tooling. */
export function bundleFileName(tag: string, version: string, kind: 'full' | 'light'): string {
    return `${tag}-${version}-${kind}.js`;
}

/** File name a private widget bundle must have when uploaded to the Portal. */
export function privateBundleFileName(tag: string, kind: 'full' | 'light'): string {
    return bundleFileName(tag, PRIVATE_WIDGET_VERSION, kind);
}

/**
 * Tag constraints imposed by the Portal storage service for private widgets:
 * valid custom-element name, no digits, no `light`/`full` substring.
 */
export function isValidPrivateWidgetTag(tag: string): boolean {
    return /^[a-z][a-z._]*-[a-z._-]*$/.test(tag) && !/light|full/.test(tag);
}

/** Environment variable prefix the CLI is allowed to inline into bundles. */
export const PUBLIC_ENV_PREFIX = 'PORTAL_WIDGET_PUBLIC_' as const;
