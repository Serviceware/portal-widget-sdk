# Security: APIs, API keys and what a widget may see

Private widgets run in the same origin, same window and same JavaScript realm as the Portal shell. There is
no sandbox. The trust boundary is the **Portal administrator who installs the widget**. Everything below
is about making it hard for an honest developer to leak something by accident.

---

## 1. Threat model: who sees what

| Data | Visible to | Consequence |
|---|---|---|
| The widget bundle (JS + inlined CSS) | Every visitor of any page that hosts the widget. Anonymous visitors too if `authenticated: false`. | Anything compiled into the bundle is public. |
| `configuration.customConfig`, `configuration.customTrans` | Every visitor of the page. Served by the API to render the page. | **Never store an API key or any credential here.** |
| Uploaded translation files | Every visitor. | Public. |
| `authToken` (element property) | The current user only. It is **their** Portal token. | A widget that sends it to a third party leaks the user's session. |
| `configuration.userProfile` | The current user only. | Personal data; never persist or forward. |
| `configuration.serviceConnections[].security.headers` | **Every visitor of the page today** (verified: anonymous config endpoints return the values, see backend-findings.md §2). | Raw keys exposed. Backend fix required; do not link keyed connections to widgets on public pages until then. |
| Portal CSP | `connect-src *`, `script-src` allows `'unsafe-inline'`/`'unsafe-eval'`. | Widgets can call any origin. No network-level protection to rely on. |

---

## 2. Three tiers for calling external APIs

### Tier 1 — Server-held secrets via Service Connections (recommended)

The Portal already models third-party credentials server-side:

```ts
type ServiceConnection = {
  id: string; name: string; module: string; url: string; isDefault: boolean;
  security?: { mode: 0 /*None*/ | 1 /*BearerToken*/ | 2 /*Custom*/; headers?: { key: string; value: string }[] };
};
```

The admin configures the connection (URL + headers such as `x-api-key`) in the Portal. The widget only
references the connection by id/name. The secret never reaches the browser **provided the Portal backend
proxies the call and injects the headers**.

**Backend status (verified, see [backend-findings.md](backend-findings.md)):**

1. **No usable proxy exists.** The gateway's `ServiceConnectionsApiHandler` only rewrites the host for the
   hard-coded `knowledge`/`messaging` modules and never applies `Security.Headers`. Tier 1 requires the new
   proxy described in backend-findings.md §4.
2. **Header values currently leak to anonymous visitors.** `RouteWidgetHelper` attaches full
   `ServiceConnections` (with plain-JSON `Security`, values included) to every route widget, and the
   unauthenticated `api/v1/config/routes/{path}` / `api/v1/config/routewidgets/{id}` endpoints return them.
   Fix proposed in backend-findings.md §2. Until fixed, admins must not store real keys in service
   connections that are linked to widgets on public pages.

Consequence for the SDK today: **there is no secure way for a browser widget to use a private API key**.
The SDK documentation says so plainly (package README, first section; `docs/sdk.md`, top note;
`docs/getting-started.md` section 9), and `createServiceClient` ships only once the proxy exists. Widget
authors who need a private key must put it in a backend they control that validates the forwarded Portal
token.

SDK surface once the proxy exists: `createServiceClient(config, connectionIdOrName)` returning a
`fetch`-compatible function that targets `{apiUrl}/api/v1/proxy/{id}/…` and attaches the Portal bearer
token.

### Tier 2 — Browser-safe public keys in `customConfig`

Keys designed to be embedded in web pages and restricted by HTTP referrer or origin (Google Maps JS key,
analytics write keys, public Mapbox tokens). Acceptable in `customConfig` with the explicit documentation
note: *"this value is visible to every visitor of the page"*.

### Tier 3 — Per-user authentication against third parties

OAuth/OIDC flows in the browser, or exchanging the Portal token for a third-party token. Out of scope for
SDK v1. Document as "bring your own".

---

## 3. Guardrails built into the SDK (runtime)

| Guardrail | Behaviour |
|---|---|
| `portalFetch(url, init)` | Adds `Authorization: Bearer <authToken>` **only** when `url` starts with `apiUrl`. Mirrors the Portal's own interceptor. No option to attach the token elsewhere. |
| Config schema with `secret: true` | `defineConfigSchema({ apiKey: { type: 'string', secret: true } })`. `saveConfiguration()` throws if any `secret` field is non-empty. Prevents persisting a secret into `customConfig` even by mistake. |
| No logging of sensitive values | The SDK never logs `configuration` or `authToken`. `debugConfig(config)` returns a redacted copy (`authToken`, `userProfile`, `serviceConnections[].security`, `secret` fields → `"[redacted]"`). |
| Token not stored | The SDK keeps `authToken` in closure scope only; never in `localStorage`, `sessionStorage`, cookies or globals. |
| No `eval`, no dynamic script injection | Keeps the SDK compatible with a future tighter CSP. |

---

## 4. Guardrails built into the CLI (build time)

| Guardrail | Behaviour |
|---|---|
| Env var allowlist | `build` inlines only variables prefixed `PORTAL_WIDGET_PUBLIC_`. Any other `process.env.X` / `import.meta.env.X` compiles to `undefined`. Same convention as Vite's `VITE_`. |
| Secret scan | `validate` (also run by `pack`) scans both bundles for known key shapes (`AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `AIza[0-9A-Za-z_-]{35}`, `ghp_…`, `xox[baprs]-…`, JWT `eyJ…\.eyJ…`, PEM `-----BEGIN … PRIVATE KEY-----`) and for long high-entropy strings. Findings fail the command; `--allow-secret-pattern <regex>` whitelists a documented false positive. |
| `.env` never bundled | esbuild is configured without any `.env` loader; `pack` refuses if any entry name matches `.env*`. |
| Zip allowlist | `pack` includes exactly: `widget-metadata.json`, the two bundles, optional `logo.png`, optional `<lang>.json`. Nothing else, no sourcemaps by default. |
| Source maps off by default | `--sourcemap` opt-in only; warns that it exposes source. |
| Reproducible output | Deterministic bundle and zip (fixed timestamps, sorted entries) so a reviewer can diff two builds. |

---

## 5. Items that need a Portal-side change (answers in [backend-findings.md](backend-findings.md))

1. **Service connection proxy endpoint** — does not exist. Request it (backend-findings.md §4). Blocks
   Tier 1.
2. **`security.headers` values leak** through anonymous config endpoints — confirmed. Redact
   (backend-findings.md §2). High priority, independent of the SDK.
3. **Admin upload of arbitrary JS** is by design (private widgets). Document for admins: only install
   bundles from sources you trust; a widget has full access to the page.
4. Consider a Portal-side, optional **allowlist of outbound origins per private widget** in the future.
   Not needed for v1; noted for completeness.

---

## 6. Developer-facing documentation checklist

The published SDK README must contain, verbatim or close to it:

- "Everything in `customConfig` is visible to every visitor of the page."
- "Never forward `authToken` to any origin other than the Portal API."
- "Private API keys belong in a Service Connection, not in the widget."
- The env var prefix rule and the secret scan behaviour, so the failure messages are not a surprise.
