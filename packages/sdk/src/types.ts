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

export const SecurityModes = { None: 0, BearerToken: 1, Custom: 2 } as const;
export type SecurityMode = (typeof SecurityModes)[keyof typeof SecurityModes];

export interface ServiceConnectionSecurity {
    mode: SecurityMode;
    /** Header values must never be exposed to the browser. See docs/security.md. */
    headers?: { key: string; value: string }[];
}

export interface ServiceConnection {
    id: string;
    name: string;
    module: string;
    url: string;
    security?: ServiceConnectionSecurity;
    isDefault: boolean;
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
