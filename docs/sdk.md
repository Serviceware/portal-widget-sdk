# `@serviceware-oss/portal-widget-sdk` — runtime API specification

Browser only. Zero runtime dependencies. ESM + CJS + `.d.ts`. Target ES2020. Size budget: **< 6 kB
minified, < 2.5 kB gzip** for the full entry; every function tree-shakeable.

npm scope: `@serviceware-oss` (confirmed).

> **Third-party credentials only through Service Connections.** A widget must never hold a private API
> key or credential: everything in the browser is visible to the visitor. The only supported way to call a
> third-party API with a credential is a Portal Service Connection through `createServiceClient` /
> `ctx.service` (section 5a), which needs Portal 3 with the Service Connection proxy. Otherwise
> authenticated calls are limited to the **Portal API as the current user** (`createPortalFetch`, section 5),
> and private keys stay in a backend you control. Do not add any other API that authenticates against third
> parties.

---

## Entry points

```ts
import { … } from '@serviceware-oss/portal-widget-sdk';          // everything
import { … } from '@serviceware-oss/portal-widget-sdk/contract'; // constants and types only
```

---

## 1. Contract constants (`/contract`)

```ts
export const PORTAL_EVENT_SUFFIX = 'SSPEvent';
export const PORTAL_EVENTS = {
  showToast: 'eventShowToast',
  showConfigModal: 'eventShowConfigModal',
  navigateRoute: 'eventNavigateRoute',
  loadWidgetSkeleton: 'eventLoadWidgetSkeleton',
  stopWidgetSkeleton: 'eventStopWidgetSkeleton',
  widgetResized: 'eventWidgetResized',
} as const;
export const ELEMENT_OUTPUTS = { configurationSaved: 'configurationSaved', configurationCanceled: 'configurationCanceled' } as const;
export const ELEMENT_INPUTS = [ 'configuration', 'authToken', 'apiUrl', 'language', 'targetLanguage', 'settingsLanguage', 'availableLanguages', 'isAdminMode', 'settingsMode', 'portalEditionMode', 'portalScreenLayout', 'showSettingsButton', 'openSettingsEvent', 'hidden' ] as const;
export const WIDGETS_CSS_LAYER = 'widgets';
export const TOAST_DEFAULT_LIFE = { success: 5000, info: 5000, warn: 4000, error: 0 } as const;
```

Plus all types from `docs/contract.md` §2–§4 (`WidgetConfig`, `WidgetVersion`, `ToastOptions`,
`ScreenLayout`, `LanguageInfo`, `UserProfile`, `ServiceConnection`, `ResizeEventArgs`, …).

These constants are the drift guard: a spec in SSP_Portal will import them and compare with the Portal's
own `Events` enum and `EventManager` suffix.

---

## 2. Portal commands (widget → Portal)

```ts
export function showToast(options: ToastOptions): void;
export const toast: {
  success(detail: string, summary?: string): void;   // life 5000
  info(detail: string, summary?: string): void;      // life 5000
  warning(detail: string, summary?: string): void;   // life 4000
  error(detail: string, summary?: string): void;     // sticky
};

export function showConfiguration(config: WidgetConfig): void;        // opens the Portal settings dialog
export function navigate(route: string, queryParams?: Record<string, string>): void;
export function showSkeleton(widgetId: string, scheme?: SkeletonScheme): void;
export function hideSkeleton(widgetId: string): void;

export function onWidgetResize(widgetId: string, cb: (size: { width: number; height: number }) => void): () => void; // returns unsubscribe
```

Implementation: `window.dispatchEvent(new CustomEvent(name + PORTAL_EVENT_SUFFIX, { detail: { ...args, handled: false } }))`.
For `showConfiguration` the detail is the config object spread plus `handled`.

---

## 3. Element outputs (widget → Portal, on the element)

```ts
export function saveConfiguration(element: HTMLElement, config: WidgetConfig, schema?: ConfigSchema): void;
export function cancelConfiguration(element: HTMLElement): void;
```

`saveConfiguration` throws `SecretInConfigError` if `schema` marks a field `secret: true` and the value is
non-empty (see security.md §3). Dispatches `configurationSaved` with `detail: config`.

---

## 4. Element helper (recommended way to build a widget)

```ts
export interface PortalWidgetInputs {
  configuration: WidgetConfig; authToken: string; apiUrl: string; language: string;
  availableLanguages: LanguageInfo[]; isAdminMode: boolean; settingsMode: boolean;
  portalEditionMode: boolean; portalScreenLayout: ScreenLayout; showSettingsButton: boolean; hidden: boolean;
}

export interface DefinePortalWidgetOptions<T> {
  tag: string;
  cssMode?: 'shadow' | 'light';                       // default 'shadow'
  styles?: string;                                    // CSS string produced by the CLI build
  configSchema?: ConfigSchema<T>;
  render(ctx: WidgetContext<T>): void | (() => void); // called on first connect; returned fn = cleanup
  onInputsChange?(changed: Partial<PortalWidgetInputs>, ctx: WidgetContext<T>): void;
}

export interface WidgetContext<T> {
  readonly element: HTMLElement;
  readonly root: ShadowRoot | HTMLElement;            // where to render
  readonly inputs: Readonly<PortalWidgetInputs & { configuration: WidgetConfig<T> }>;
  fetch: typeof fetch;                                // portalFetch bound to current apiUrl/authToken
  service(connectionIdOrName: string): ServiceFetch;  // Service Connection proxy, section 5a
  serviceConnections(): ServiceConnectionInfo[];      // linked connections, no secret values, section 5a
  toast: typeof toast;
  openSettings(): void;                               // showConfiguration(inputs.configuration)
  save(customConfig: T, options?: { serviceConnectionsId?: string[] }): void; // clones configuration, sets customConfig, saveConfiguration()
  cancel(): void;
  onResize(cb: (size: { width: number; height: number }) => void): () => void;
  loadTranslations(lang?: string): Promise<Record<string, string>>; // GET storage/v1/widgets/{tag}/{version}/translations/{lang}
}

export function definePortalWidget<T>(options: DefinePortalWidgetOptions<T>): void; // calls customElements.define
```

Behaviour:

- Creates a class extending `HTMLElement` with accessors for every `ELEMENT_INPUTS` name. Setting a
  property stores it, and once connected, batches changes into one `onInputsChange` call per microtask.
- `render` runs on `connectedCallback` **after** the first `configuration` is set (Portal sets properties
  before/around connect; the helper waits one microtask to collect them).
- Injects `styles` into `root` (shadow) or a document `<style data-portal-widget=tag>` (light) exactly once
  per tag.
- Never logs inputs.

Frameworks: React/Vue/Lit examples mount into `ctx.root`. No framework adapter packages in v1.

---

## 5. Authenticated fetch (Portal API only)

```ts
export function createPortalFetch(getAuth: () => { apiUrl: string; authToken: string }): typeof fetch;
```

Adds `Authorization: Bearer` only when the resolved request URL starts with `apiUrl`. Same-origin relative
URLs are resolved against `apiUrl` first. No option to disable the check.

This is the **only** authentication the SDK offers, and it authenticates the current user against the
Portal, not the widget against anything else. There is no way to attach a widget-owned or third-party
credential; use a Service Connection (section 5a).

### 5a. `createServiceClient` / `ctx.service` / `ctx.serviceConnections` (Service Connection proxy)

Requires Portal 3 with the Service Connection proxy (no version number assigned yet). Wire contract:
[contract.md](contract.md) §5a; background: [service-connection-proxy.md](service-connection-proxy.md).

```ts
export type ServiceFetch = (path: string, init?: RequestInit) => Promise<Response>;
export function createServiceClient(
    getSource: () => { apiUrl: string; authToken: string; configuration: WidgetConfig<unknown> | undefined },
    connectionIdOrName: string
): ServiceFetch;
export function resolveServiceConnection(config, connectionIdOrName): { id: string } | undefined;
export function listServiceConnections(config: WidgetConfig<unknown> | undefined): ServiceConnectionInfo[];
export class ServiceConnectionNotFoundError extends Error { readonly connection: string }

export interface ServiceConnectionInfo {
    id: string; name: string; module: string;
    mode: number; modeName: SecurityModeName | 'Unknown';
    isDefault: boolean; hasCredentials: boolean; allowAnonymous: boolean;
    url: string | null;
}
// WidgetContext: service(connectionIdOrName: string): ServiceFetch
//                serviceConnections(): ServiceConnectionInfo[]
```

- Targets `{apiUrl}/api/v1/proxy/{connectionId}/{path}` through `createPortalFetch`, so the Portal bearer
  token is attached by the same origin rule, and not at all when `authToken` is empty (anonymous pages; the
  Portal allows that only for connections with `allowAnonymous`). A caller-supplied `Authorization` header
  is dropped. `X-Portal-Widget-Instance` is set to `configuration.id`.
- `connectionIdOrName` is matched against `serviceConnections[].id`, then `serviceConnectionsId`, then
  `serviceConnections[].name` (case-insensitive). `getSource` is read on every call.
- Rejects without sending anything: `ServiceConnectionNotFoundError` when nothing matches, `TypeError` for
  absolute or protocol-relative URLs and for `.` / `..` path segments.
- Every answer comes back as the `Response`, unchanged; there is no error class per status. The proxy's own
  statuses are `400`, `401`, `404`, `429` (honour `Retry-After`), `502`, `504` (`SERVICE_PROXY_STATUS`);
  upstream statuses pass through. The SDK never retries.
- `listServiceConnections` / `ctx.serviceConnections()` describe the linked connections. They copy no
  header, query, password or secret value, not even the `********` masks. `hasCredentials` is true for
  `BearerToken`, `Basic`, `OAuth2ClientCredentials` and `Custom` with at least one header or query
  parameter. `allowAnonymous` is false when the Portal does not send it. `url` is `null` when the Portal
  hides it. Connections linked only by id (right after `save`, before the Portal re-sends the objects) are
  not listed.
- Linking: `ctx.save(customConfig, { serviceConnectionsId: [connectionId] })` (`SaveOptions`) replaces
  `configuration.serviceConnectionsId`, and the Portal persists it. Store the connection **id** in
  `customConfig`: it resolves immediately through `serviceConnectionsId`, before the Portal re-sends the
  linked connection objects.

---

## 6. Config schema helper

```ts
export function defineConfigSchema<T>(schema: ConfigSchema<T>): ConfigSchema<T>;
type ConfigSchema<T> = { [K in keyof T]: { type: 'string' | 'number' | 'boolean' | 'json'; secret?: boolean; default?: T[K] } };
export function withDefaults<T>(config: WidgetConfig<T>, schema: ConfigSchema<T>): T;
export function debugConfig(config: WidgetConfig, schema?: ConfigSchema): unknown; // redacted copy
```

---

## 7. Tests (vitest + jsdom)

- Each command dispatches exactly one event, with the exact type string and `detail` shape from
  contract.md. Snapshot the payloads.
- `createPortalFetch` never adds the header for a foreign origin, including `apiUrl` as a prefix of a
  different host (`https://portal.example.com.evil.net`) — compare on parsed `origin + pathname` prefix,
  not string prefix.
- `saveConfiguration` throws on non-empty secret field, passes on empty.
- `definePortalWidget` collects properties set before connect and calls `render` once.
