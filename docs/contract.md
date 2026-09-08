# Portal ↔ Widget Contract

Everything a private widget needs to know to run inside Serviceware Portal 3.x. Verified against
`SSP_Portal` branch `portal30` at commit `5db6e508` (see [reference-sources.md](reference-sources.md)).

Both packages in this repo implement this document. When the Portal changes, update this file first.

---

## 1. What a widget is

A widget is a **custom element** delivered as a **single classic JavaScript file**. The Portal:

1. Fetches the file from `{apiURL}/storage/v1/widgets/{fileName}` and injects it as a classic
   `<script>` (not a module). The bundle **must** call `customElements.define('<tag>', ...)` for the tag
   registered in the widget metadata.
2. Creates `<tag>` inside its grid, sets a fixed set of **properties** on the element, and listens for two
   **DOM events** on it.
3. Stamps an attribute named after the tag on its own host wrapper (`<ssp-portal-widget my-tag>`), which is
   the anchor for CSS scoping.
4. Runs a CSS compliance probe about 1.5 s after mount.

Widget ↔ Portal messaging beyond element I/O is done with `CustomEvent`s dispatched on `window`.

---

## 2. Custom element inputs (properties set by the Portal)

Set as JS properties (not attributes) on the element, in the order Angular binds them. Any of them may be
set again during the widget's lifetime.

| Property | Type | Meaning |
|---|---|---|
| `configuration` | `WidgetConfig<T>` | The widget instance: id, `customConfig` (your settings), translations override, position, user profile, version. Re-set whenever the admin saves settings. |
| `authToken` | `string` | Current user's Portal bearer token. Empty for anonymous users. Refreshed on token renewal. |
| `apiUrl` | `string` | Base URL of the Portal API gateway, e.g. `https://portal.example.com/api-gateway`. |
| `language` | `string` | Selected locale, e.g. `de-DE` or `en`. |
| `targetLanguage` | `string` | Same value as `language` (legacy). |
| `settingsLanguage` | `string` | Same value as `language` (legacy). |
| `availableLanguages` | `{ code: string; nativeName: string; id: number }[]` | Languages enabled in the Portal. |
| `isAdminMode` | `boolean` | Admin is logged in and administration mode is on. |
| `settingsMode` | `boolean` | The element is being rendered inside the **settings dialog**. Render your settings UI instead of the widget. |
| `portalEditionMode` | `boolean` | Admin is in grid edit mode (drag/resize). |
| `portalScreenLayout` | `'desktop' \| 'tablet' \| 'mobile'` | Current responsive layout. |
| `showSettingsButton` | `boolean` | Portal asks the widget to show its own settings entry point (admin, not editing, not in settings dialog). |
| `openSettingsEvent` | `boolean` | Legacy flag, equals `isAdminMode`. |
| `hidden` | `boolean` | Widget should render nothing (also toggled via the `hidden` attribute). |

`WidgetConfig<T>` shape:

```ts
interface WidgetConfig<T = Record<string, unknown>> {
  id: string;                               // route-widget instance id
  routeId: number;                          // page id
  customConfig: T;                          // your saved settings (PUBLIC, see security.md)
  customTrans?: Record<string, Record<string, string>>; // per-language translation overrides
  meta: { language: string; name: string }[];
  usedVersion: WidgetVersion;
  position: { desktop?: GridPosition; tablet?: GridPosition; mobile?: GridPosition; /* ... */ };
  userProfile: UserProfile | null;          // per-user, never persist
  showAsFullScreenInMobile?: boolean;
  fullScreenTitle?: Record<string, string>;
  tempId?: number;
  serviceConnectionsId?: string[];
  serviceConnections?: ServiceConnection[];
}

interface WidgetVersion {
  id: string;
  name: string;            // the custom-element tag
  number: string;          // semver
  authenticated: boolean;
  angularVersion: number;  // 0 for non-Angular widgets
  fileName: string;        // full bundle file name
  fileNameLight: string;   // light bundle file name
  widgetId?: string;
}
```

Exact TypeScript definitions live in `packages/sdk/src/types.ts`.

---

## 3. Custom element outputs (DOM events the Portal listens for on the element)

| Event name | `detail` | Effect |
|---|---|---|
| `configurationSaved` | `WidgetConfig<T>` (the full object, with your updated `customConfig`) | Portal persists the configuration and closes the settings dialog. |
| `configurationCanceled` | none | Portal closes the settings dialog without saving. |

Dispatch with `element.dispatchEvent(new CustomEvent('configurationSaved', { detail: config }))`. The
events do not need to bubble; the Portal listens directly on the element.

---

## 4. Window events (widget → Portal and Portal → widget)

All events are `CustomEvent`s on `window`. The **event type is the name plus the suffix `SSPEvent`**.
The payload is in `event.detail` and always carries `handled: false` alongside the arguments.

### Widget → Portal

| Name | Full event type | `detail` | Portal behaviour |
|---|---|---|---|
| `eventShowToast` | `eventShowToastSSPEvent` | `{ message: ToastOptions, handled: false }` | Renders a toast in the shell. |
| `eventShowConfigModal` | `eventShowConfigModalSSPEvent` | `WidgetConfig` object (spread) `+ handled: false` | Opens the settings dialog for that widget instance (Portal `structuredClone`s the payload). |
| `eventNavigateRoute` | `eventNavigateRouteSSPEvent` | `{ route: string, queryParams?: Record<string,string>, handled: false }` | Router navigation inside the Portal. |
| `eventLoadWidgetSkeleton` | `eventLoadWidgetSkeletonSSPEvent` | `{ widgetId, scheme, errorMessageAdmin: '', errorMessageUser: '', handled: false }` | Shows a skeleton over the widget instance with that `widgetId`. `scheme` may be `undefined` for the default. |
| `eventStopWidgetSkeleton` | `eventStopWidgetSkeletonSSPEvent` | `{ widgetId, handled: false }` | Hides the skeleton. |

```ts
type ToastSeverity = 'success' | 'info' | 'warn' | 'error';
interface ToastOptions {
  severity: ToastSeverity;
  detail: string;       // body text
  summary?: string;     // title
  life?: number;        // ms; Portal defaults: success/info 5000, warn 4000, error sticky
  sticky?: boolean;
  closable?: boolean;
}
```

### Portal → widget

| Name | Full event type | `detail` |
|---|---|---|
| `eventWidgetResized` | `eventWidgetResizedSSPEvent` | `{ widgetId: string, newHeight: number, newWidth: number }` — filter on your own `configuration.id`. |

Other events exist in the Portal (`eventSwPortalLogin`, `eventSwPortalLogout`, `eventSwPortalTryLogout`,
`eventSwPortalCancelLogout`, `eventProcessesLogin409`, material-icon list events, knowledge events,
`chatWidgetReceivedMessage`). They are product-specific and **out of scope** for the SDK v1.

---

## 5. Authenticated calls to the Portal API

- Base URL is the `apiUrl` property.
- The Portal's own widgets attach `Authorization: Bearer <authToken>` **only when the request URL starts
  with `apiUrl`**. The SDK's `portalFetch` mirrors this and has no override.
- Useful endpoints for widgets:
  - `GET {apiUrl}/storage/v1/widgets/{tag}/{version}/translations/{lang}` → translation JSON, response
    header `x-sw-language` tells which language was actually served. Private widgets' uploaded `<lang>.json`
    files are served here.

---

## 6. Light vs full bundles

The Portal picks which file to load per widget version:

```
usedVersion.angularVersion === <Portal's Angular major>  →  fileNameLight
otherwise                                                →  fileName (full)
```

The Portal exposes these globals for light builds of **Angular** widgets: `ng.core`, `ng.common`,
`ng.common.http`, `ng.router`, `ng.forms`, `ng.elements`, `ng.platformBrowser`, `ng.animations`,
`ng.animations.browser`, `ng.core.rxjsInterop`, `ng.core.primitives.signals`, `rxjs`, `rxjs.operators`,
and a set of `syncfusion.ej2.*` modules. Portal Angular major today: **22**.

Rules for SDK widgets:

- Non-Angular widget → set `angularVersion: 0`. The full bundle is always used. The upload form still
  requires a light file, so the CLI emits both; the light file may be identical to the full one.
- Angular widget → only claim an `angularVersion` you actually externalised against. Otherwise runtime
  breaks when the Portal upgrades. Prefer `angularVersion: 0` and a full bundle unless size matters.

File name convention (used by the Portal's own tooling): `<tag>-<version>-full.js` and
`<tag>-<version>-light.js`.

**Private widgets: the version in the file name must be `1.0.0`.** The backend stores every private widget
as version `1.0.0` and resolves the bundle from the requested file name (see
[backend-findings.md](backend-findings.md) §3). Upload exactly `<tag>-1.0.0-full.js` and
`<tag>-1.0.0-light.js`; any other name results in a 404 when the Portal loads the widget. The CLI always
emits these names for private widgets and records the real semver only in `widget-metadata.json`.

Source maps: the Portal's own tooling ships **none** in widget bundles. Default off in the CLI.

---

## 7. CSS isolation contract (summary; details in [css-isolation.md](css-isolation.md))

Portal cascade layers, declared in the shell:

```css
@layer codeblue-legacy, codeblue3, portal-base, primeng, portal-overrides, widgets, app-overrides;
```

Compliance probe (runs ~1.5 s after mount, warning today, hard fail after Portal 3.0 GA):

| Check | Passes when |
|---|---|
| `host_attribute_mismatch` | the host wrapper still carries the `[<tag>]` attribute |
| `missing_css_scope_attribute` | some rule in `document.styleSheets` has a selector containing `[<tag>]` |
| `css_layer_mismatch` | that rule lives inside `@layer widgets` |

Unlayered author CSS outranks **every** Portal layer (CSS Cascade L5). A widget must never emit unlayered
CSS into the document. Shadow-DOM widgets do not appear in `document.styleSheets`; a Portal-side change to
the probe is required before they can pass (tracked in [plan.md](plan.md)).

---

## 8. Widget metadata (`widget-metadata.json` in the widget repo)

Schema: [`schemas/widget-metadata.schema.json`](../schemas/widget-metadata.schema.json) (copied from the
Portal monorepo). Key fields:

```jsonc
{
  "id": "<uuid v4, stable for the widget's lifetime>",
  "name": "my-widget",                       // the custom-element tag
  "logo": null,                              // or base64 PNG
  "tags": ["Portal"],
  "meta": [{ "language": "en", "name": "My Widget", "description": "<p>…</p>", "descriptionShort": "" }],
  "widgetVersion": {
    "id": "<uuid v4, new per version>",
    "name": "my-widget",
    "number": "1.0.0",
    "date": "2026-09-04 10:00",
    "state": "released",                     // dev | preview | released | deprecated | archived
    "authenticated": false,                  // true = only logged-in users may see it
    "angularVersion": 0,
    "portalVersion": "v3",
    "defaultSize": { "columns": 2, "rows": 1 },
    "filename": "my-widget-1.0.0.tar.gz",    // legacy registry field, keep in sync
    "changes": [{ "language": "en", "description": "<p>Initial release.</p>" }],
    "dependencies": [{ "name": "Portal", "dependency": ">=3.0.0" }]
  }
}
```

Tag name rules: valid custom-element name (lowercase, contains a hyphen, no reserved names such as
`font-face`), unique per tenant and not colliding with global widget names (server-validated). Because of
how the storage service resolves private bundles ([backend-findings.md](backend-findings.md) §3) the tag
must additionally contain **no digits** and **not contain `light` or `full`** as a substring.

---

## 9. Private widget import zip

Produced by the Portal's own export and by the CLI `pack` command. Unzipped by the admin dialog with
`fflate`. Contents:

| Entry | Required | Notes |
|---|---|---|
| `widget-metadata.json` | yes | **Import DTO shape, not the schema in §8.** See below. |
| `<fileFullName>` | yes | Full bundle, name referenced from the metadata. |
| `<fileLightName>` | yes | Light bundle, name referenced from the metadata. |
| `logo.png` | no | PNG logo. |
| `<lang>.json` | no | Translation files, one per language code, e.g. `en.json`, `de-DE.json`. Must be valid non-empty JSON. The server accepts only names that are valid .NET `CultureInfo` names (case-insensitive). **Every other `.json` in the zip is treated as a translation file**, so nothing else may be included. |

Import DTO shape (schema: [`schemas/widget-package-metadata.schema.json`](../schemas/widget-package-metadata.schema.json)):

```jsonc
{
  "tagName": "my-widget",
  "name":        [{ "language": "en", "value": "My Widget" }],
  "description": [{ "language": "en", "value": "<p>…</p>" }],
  "tags": ["Portal"],
  "defaultSize": { "columns": 2, "rows": 1 },
  "angularVersion": 0,
  "authenticated": false,
  "changes":     [{ "language": "en", "value": "<p>Initial release.</p>" }],
  "dependencies": [{ "name": "Portal", "dependency": ">=3.0.0" }],
  "fileFullName": "my-widget-1.0.0-full.js",
  "fileLightName": "my-widget-1.0.0-light.js"
}
```

Mapping from §8 metadata to the import DTO (what `pack` does):

| Repo metadata | Import DTO |
|---|---|
| `name` / `widgetVersion.name` | `tagName` |
| `meta[].name` | `name[] { language, value }` |
| `meta[].description` | `description[] { language, value }` |
| `tags` | `tags` (max 10) |
| `widgetVersion.defaultSize` | `defaultSize` |
| `widgetVersion.angularVersion` | `angularVersion` |
| `widgetVersion.authenticated` | `authenticated` |
| `widgetVersion.changes[].description` | `changes[] { language, value }` |
| `widgetVersion.dependencies` | `dependencies` (max 10) |
| built file names | `fileFullName`, `fileLightName` |
| `logo` (base64) | `logo.png` entry |

Limits enforced by the admin dialog: name ≤ 100 chars, description ≤ 4000 chars, tag name ≤ 100 chars,
max 10 tags, max 10 dependencies, an `en` entry is required for name, description and changes. The server
additionally requires `en` in name and description, `.js` bundles, and culture-named `.json` translation
files; it stores the widget as version **`1.0.0`** and ignores any other version.

### Backend endpoint used by the dialog (for a future `publish` command)

`POST {apiUrl}/api/v2/admin/widgets/private` (edit: `PUT .../private/{widgetId}`), multipart form data:
`tagName`, `tags` (JSON), `name` (JSON), `description` (JSON), `defaultSize` (JSON), `logo` (base64,
optional), `fileFull` (file), `fileLight` (file), `fileLanguages` (file, repeatable), `angularVersion`,
`authenticated`, `changes` (JSON), `dependencies` (JSON). Requires an admin bearer token.

---

## 10. Local testing against a Portal

- **Portal you run yourself** (monorepo checkout): drop the bundle and `widget-metadata.json` into
  `dist/widgets/<folder>/` and run `pnpm start:dev-widgets <folder>`; the shell reads
  `apps/admin/src/assets/dev-widgets.json` on startup and loads your local file for that tag.
- **Deployed Portal**: Chrome DevTools → Sources → Overrides, override the
  `{apiURL}/storage/v1/widgets/<file>.js` response with your build.
- Either way: open the console and confirm there is **no `[Widget Compliance]` warning**.
