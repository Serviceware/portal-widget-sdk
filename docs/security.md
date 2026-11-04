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
| `configuration.serviceConnections[]` | Every visitor of the page. | With the Service Connection proxy: names, mode and header/query **keys** only; every value is `********`, and `url` is `null` for anonymous visitors when the connection has credentials. Without the proxy the values are sent in clear (backend-findings.md §2): do not link keyed connections to widgets on public pages there. |
| Portal CSP | `connect-src *`, `script-src` allows `'unsafe-inline'`/`'unsafe-eval'`. | Widgets can call any origin. No network-level protection to rely on. |

---

## 2. Three tiers for calling external APIs

### Tier 1 — Server-held secrets via Service Connections (recommended)

Requires Portal 3 with the Service Connection proxy ([service-connection-proxy.md](service-connection-proxy.md),
[contract.md](contract.md) §5a). Secrets go into a **Service Connection**, never into `customConfig` and never
into a `secret: true` field: everything a widget saves ends up in the browser of every visitor.

- The **admin** creates the connection in the Portal (base URL + mode + credential) and links it to the widget
  instance in the widget settings. The Portal encrypts the credential at rest and returns it only as
  `"********"`, to admins too.
- The **widget** stores only the connection id or name in `customConfig` and calls
  `ctx.service(idOrName)(path)`. The request goes to the Portal, which checks the link and the caller, drops
  the caller's `Authorization` and cookies, adds the credential and forwards to the connection URL.
- Modes, from the widget author's view: `Custom` (API key as header or query parameter), `BearerToken`
  (fixed bearer token), `Basic` (username + password), `OAuth2ClientCredentials` (client id + secret; the
  Portal fetches the access token), `ForwardUserToken` (the logged-in user's Portal token, for a backend that
  trusts the Portal's identity provider), `None`.
- **Anonymous pages** work only for connections the admin marked `allowAnonymous` (never
  `ForwardUserToken`); the Portal rate limits them per client IP. For anonymous callers the Portal also
  returns `url: null` for connections with credentials.
- `ctx.serviceConnections()` tells the widget which connections are linked (id, name, mode, flags) without
  any secret or masked value. Do not read `configuration.serviceConnections[].security` values yourself:
  Portals without the proxy still send them in clear.

On a Portal without the proxy there is **no secure way for a browser widget to use a private API key**. Use
tier 2 for keys that are public by design, or a backend you control that holds the key and validates the
forwarded Portal token.

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
| `ctx.service()` / `createServiceClient` | Only paths relative to the connection URL (no scheme, no `//`, no `.`/`..` segments). A caller-set `Authorization` is dropped; the Portal token goes only to `apiUrl`, and none is sent for anonymous users. |
| `ctx.serviceConnections()` / `listServiceConnections` | Copy id, name, module, mode and flags only; never header, query, password or secret values, not even the masks. |
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

1. **Service connection proxy endpoint** — provided by Portal 3 with the Service Connection proxy
   (contract.md §5a). Enables Tier 1.
2. **`security.headers` values leak** through anonymous config endpoints — fixed by the same change (values
   masked on every read, `url` hidden from anonymous callers). Portals without it still leak.
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
