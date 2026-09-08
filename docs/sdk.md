# `@serviceware/portal-widget-sdk` — runtime API specification

Browser only. Zero runtime dependencies. ESM + CJS + `.d.ts`. Target ES2020. Size budget: **< 6 kB
minified, < 2.5 kB gzip** for the full entry; every function tree-shakeable.

npm scope: `@serviceware` (confirmed).

> **No secure third-party authentication in v1.** A widget cannot use a private API key or credential
> safely: everything in the browser is visible to the visitor, and the Portal has no server-side proxy for
> Service Connections yet (it even exposes stored header values to anonymous visitors,
> [backend-findings.md](backend-findings.md) sections 1 and 2). The SDK therefore ships no
> `createServiceClient`. Authenticated calls are limited to the **Portal API as the current user**
> (`createPortalFetch`, section 5). Private keys must stay in a backend you control. Widget authors are told
> this in the package README and in [getting-started.md](getting-started.md) section 9; do not add any API
> that looks like it authenticates against third parties before the proxy exists.

---

## Entry points

```ts
import { … } from '@serviceware/portal-widget-sdk';          // everything
import { … } from '@serviceware/portal-widget-sdk/contract'; // constants and types only
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
  toast: typeof toast;
  openSettings(): void;                               // showConfiguration(inputs.configuration)
  save(customConfig: T): void;                        // clones configuration, sets customConfig, saveConfiguration()
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
credential; see the note at the top of this document.

### 5a. Planned: `createServiceClient` (blocked on the Portal)

```ts
// NOT SHIPPED. Requires the Portal proxy described in backend-findings.md section 4.
export function createServiceClient(config: WidgetConfig, connectionIdOrName: string): typeof fetch;
```

Would target `{apiUrl}/api/v1/proxy/{connectionId}/...` with the Portal bearer token; the Portal would
inject the Service Connection's headers server-side so the key never reaches the browser. Ships only once
that endpoint exists and the header-value leak in the anonymous config endpoints is fixed.

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
