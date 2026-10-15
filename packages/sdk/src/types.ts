/**
 * Types mirrored from the Portal (see docs/contract.md §2–§4 and docs/reference-sources.md).
 * Keep field names identical to the Portal's interfaces; the objects are passed through verbatim.
 */

export type ToastSeverity = 'success' | 'info' | 'warn' | 'error';

export interface ToastOptions {
    severity: ToastSeverity;
    /** Body text */
    detail: string;
    /** Title */
    summary?: string;
    /** Lifetime in ms. 0 or `sticky: true` keeps the toast open. */
    life?: number;
    sticky?: boolean;
    closable?: boolean;
}

export type ScreenLayout = 'desktop' | 'tablet' | 'mobile';

export interface LanguageInfo {
    code: string;
    nativeName: string;
    id: number;
}

export interface GridPosition {
    x: number;
    y: number;
    columns: number;
    rows: number;
    [extra: string]: unknown;
}

export interface WidgetPosition {
    desktop?: GridPosition;
    tablet?: GridPosition;
    mobile?: GridPosition;
    [extra: string]: unknown;
}

export interface WidgetMeta {
    language: string;
    name: string;
    description?: string;
    descriptionShort?: string;
}

export interface WidgetVersion {
    id: string;
    /** The custom-element tag */
    name: string;
    /** Semver */
    number: string;
    authenticated: boolean;
    /** 0 for non-Angular widgets */
    angularVersion: number;
    fileName: string;
    fileNameLight: string;
    widgetId?: string;
}

/** Per-user data. Never persist or forward. Shape is Portal-defined and may grow. */
export interface UserProfile {
    id?: string;
    userName?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    language?: string;
    [extra: string]: unknown;
}

/** How the Portal authenticates a Service Connection against the third party (docs/contract.md §5a). */
export const SecurityModes = {
    /** Nothing is added. */
    None: 0,
    /** One `Authorization: Bearer …` header. */
    BearerToken: 1,
    /** Custom headers and query parameters, e.g. an API key header. */
    Custom: 2,
    /** `Authorization: Basic …` from a stored username and password. */
    Basic: 3,
    /** Bearer token the Portal fetches with the OAuth 2.0 client credentials grant. */
    OAuth2ClientCredentials: 4,
    /** The caller's Portal access token is forwarded (logged-in users only). */
    ForwardUserToken: 5
} as const;
export type SecurityModeName = keyof typeof SecurityModes;
export type SecurityMode = (typeof SecurityModes)[SecurityModeName];

/** A header or query parameter of a Service Connection. The Portal always returns `value` as `"********"`. */
export interface ServiceConnectionKeyValue {
    key: string;
    value: string;
}

/**
 * Security settings of a Service Connection, as the Portal returns them. Every secret value (header and
 * query values, `basic.password`, `oAuth2.clientSecret`) is masked as `"********"` on every read; empty
 * means "not set". Do not read or display the masks: use `listServiceConnections()` instead.
 */
export interface ServiceConnectionSecurity {
    mode: SecurityMode;
    headers?: ServiceConnectionKeyValue[] | null;
    queryParameters?: ServiceConnectionKeyValue[] | null;
    basic?: { username: string; password: string } | null;
    oAuth2?: {
        tokenUrl: string;
        clientId: string;
        clientSecret: string;
        scope?: string | null;
        audience?: string | null;
    } | null;
    /** The proxy may be used from anonymous (public) pages. Never true for `ForwardUserToken`. */
    allowAnonymous?: boolean;
}

export interface ServiceConnection {
    id: string;
    name: string;
    module: string;
    /** Base URL of the third-party API. `null` for anonymous callers when the connection carries credentials. */
    url: string | null;
    security?: ServiceConnectionSecurity;
    isDefault: boolean;
    websiteId?: number | string;
}

/** Per-language translation overrides: `{ en: { key: 'text' } }` */
export type LanguageTranslations = Record<string, Record<string, string>>;

export interface WidgetConfig<T = Record<string, unknown>> {
    /** Route-widget instance id */
    id: string;
    routeId: number;
    /** Your saved settings. PUBLIC to every page visitor. */
    customConfig: T;
    customTrans?: LanguageTranslations;
    meta: WidgetMeta[];
    usedVersion: WidgetVersion;
    position: WidgetPosition;
    userProfile: UserProfile | null;
    showAsFullScreenInMobile?: boolean;
    fullScreenTitle?: Record<string, string>;
    tempId?: number;
    serviceConnectionsId?: string[];
    serviceConnections?: ServiceConnection[];
}

export interface NavigateRouteArgs {
    /** Portal-relative route, e.g. '/home' */
    route: string;
    queryParams?: Record<string, string>;
}

export interface ResizeEventArgs {
    widgetId: string;
    newHeight: number;
    newWidth: number;
}

/** Skeleton scheme is Portal-defined; pass through or omit for the default. */
export type SkeletonScheme = Record<string, unknown>;

export interface LoadSkeletonArgs {
    widgetId: string;
    scheme?: SkeletonScheme;
    errorMessageAdmin: string;
    errorMessageUser: string;
}

/** Every window event payload carries this flag (always dispatched as false). */
export interface PortalEventDetail {
    handled: boolean;
}

/** Inputs the Portal sets on the element (see ELEMENT_INPUTS). */
export interface PortalWidgetInputs<T = Record<string, unknown>> {
    configuration: WidgetConfig<T>;
    authToken: string;
    apiUrl: string;
    language: string;
    targetLanguage: string;
    settingsLanguage: string;
    availableLanguages: LanguageInfo[];
    isAdminMode: boolean;
    settingsMode: boolean;
    portalEditionMode: boolean;
    portalScreenLayout: ScreenLayout;
    showSettingsButton: boolean;
    openSettingsEvent: boolean;
    hidden: boolean;
}

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'json';

export interface ConfigField<V = unknown> {
    type: ConfigFieldType;
    /** Marks a field that must never be persisted into customConfig. saveConfiguration() throws if non-empty. */
    secret?: boolean;
    default?: V;
}

export type ConfigSchema<T> = { [K in keyof T]: ConfigField<T[K]> };
