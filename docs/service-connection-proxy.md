# Service Connection proxy (POC)

**Status: experimental proof of concept.** It needs the Portal backend branch
`poc/widget-connection-proxy` (`portal-backend` repository). No released Portal has this endpoint. On a
released Portal `ctx.service()` gets a 404, and [security.md](security.md) tier 1 still applies as written
there.

Goal: a widget calls a third-party API that needs an API key or bearer token, **and the credential never
reaches the browser**. It implements the proposal in [backend-findings.md](backend-findings.md) §4.

---

## 1. Flow

```
widget (browser)                      Portal API                              third-party API
────────────────                      ──────────                              ───────────────
ctx.service('weather')('forecast?city=Bonn')
  GET {apiUrl}/api/v1/proxy/{connectionId}/forecast?city=Bonn
  Authorization: Bearer <Portal token>
  X-Portal-Widget-Instance: <configuration.id>   ─►  1. authenticate the Portal user ([Authorize])
                                                      2. connection linked to that route widget,
                                                         same website (tenant)? else 404
                                                      3. decrypt the stored headers
                                                      4. drop Authorization, Cookie, X-Forwarded-*, ...
                                                      5. inject x-api-key / Authorization  ─►  GET {connection.url}/forecast?city=Bonn
                                                      6. copy allowlisted response headers ◄─  200 {...}
  ◄─ 200 {...}
```

The admin stores the credential once, in **Portal Admin → Configure → Connections** (mode *BearerToken* or
*Custom* headers). Then, in the widget's own settings dialog, the admin picks the connection. The widget
lists connections with `ctx.fetch('api/v2/admin/serviceconnections')`, the same endpoint the Portal's own
widgets use, and saves with `ctx.save(customConfig, { serviceConnectionsId: [id] })`. That link is what the
proxy checks. `customConfig` holds only the connection id, which is public and harmless.

## 2. What changed in the backend (branch `poc/widget-connection-proxy`)

| Change | Where (`src/Portal/…`) |
|---|---|
| **Encryption at rest.** Header values are stored as `enc:v1:` + AES-256-GCM (random nonce, authenticated). The key comes from `ServiceConnections:SecretKey` (env `ServiceConnections__SecretKey`, base64, 32 bytes). Rows written before this change are still read as plaintext and get encrypted on their next save. | `utils/Portal.Utils/Implementation/AesGcmSecretProtector.cs`, `business/Portal.Domain/ServiceConnections/Secrets/ServiceConnectionSecrets.cs`, Add/Update handlers |
| **Masking on read.** Every read model, admin included, returns header values as `********`. This closes the anonymous leak through `api/v1/config/routes/{path}` and `routewidgets/{id}` ([backend-findings.md](backend-findings.md) §2). On update, a masked value (`********` or `Bearer ********`) keeps the stored value, so re-saving from the admin UI keeps the key. | `Models/Helpers/ServiceConnectionMapper.cs` |
| **`security` is now a JSON object** (`{ mode, headers: [{ key, value }] }`) instead of a JSON *string*. This fixes a pre-existing bug: the admin UI reads `security.mode` as an object, so on a string the edit dialog always showed mode *None*, and saving it wiped the stored headers. The SDK's `ServiceConnection` type always assumed an object. | `Models/ServiceConnection.cs` |
| **Linking connections to widget instances.** Implemented in the Add/Update route-widget handlers. They previously accepted `ServiceConnectionsId` and ignored it (`//Missing add route widget service connection handler`), so the link table was never written. Only ids of the current website are stored; `null` keeps the existing links. | `RouteWidgetServiceConnections/Commands/SetRouteWidgetServiceConnections/`, `RouteWidgetServiceConnectionRepository.ReplaceForWidgetAsync` |
| **`ISecretProtector` is registered in every host** that scans the Domain handlers (Portal.Api, Storage.Api, ApiGateway, PlatformListener). Without it, Development DI validation stops the host at startup. | each host's service registration |
| **Tenant check on update.** Updating another website's connection by id is rejected. | `UpdateServiceConnectionCommandHandler.cs` |
| **Proxy endpoint** `GET/POST/PUT/PATCH/DELETE api/v1/proxy/{connectionId}/{**path}`. It requires a logged-in Portal user and the header `X-Portal-Widget-Instance`. The connection must be linked to that route widget and belong to the current website. It returns one 404 for missing, other-tenant and not-linked connections. | `hosting/Portal.Api/Controllers/ServiceConnectionProxyController.cs`, `Domain/ServiceConnections/Queries/GetServiceConnectionProxyTarget/` |
| **Forwarder.** The target is built from `connection.url` + path, with segments re-escaped and dot segments rejected. The result must stay under the base URL, and the base must be absolute http(s). Request and response headers go through allowlists. Redirects are not followed. The timeout is 30 s, request and response are each capped at 10 MB, and `Cache-Control: private, no-store` is set unless upstream sets its own. Logs record the connection id, status and duration, never headers. The secrets are never cached (no Redis). | `hosting/Portal.Api/Services/ServiceConnectionProxy/ServiceConnectionProxyForwarder.cs` |

No DB migration is needed. The gateway already routes `/api/v1/{everything}` to Portal.Api.

## 3. SDK surface (experimental)

```ts
// inside definePortalWidget render(ctx)
const weather = ctx.service('weather');            // connection name or id, as linked to this instance
const res = await weather('forecast?city=Bonn');   // path relative to the connection URL
```

Standalone: `createServiceClient(() => ({ apiUrl, authToken, configuration }), 'weather')`. It rejects with
`ServiceConnectionNotFoundError` when the connection is not linked, and with `TypeError` for absolute URLs
or `.`/`..` segments. Contract constants: `SERVICE_PROXY_PATH`, `WIDGET_INSTANCE_HEADER`,
`serviceProxyPath()`. Details: [contract.md](contract.md) §5a, [sdk.md](sdk.md) §5a.

## 4. Try it

**Without a backend:** run `examples/service-connection-demo` with `pnpm dev`
(http://localhost:4204). Its dev server mocks the proxy with the same rules. The demo key exists only in
the Node process, and the page log shows every request that leaves the browser.

**Against the backend branch** (verified end to end on 2026-09-24 with `portal-frontend` `pnpm start:admin`):

1. Put the key in an untracked `src/Portal/docker-compose.override.yml`, not in the tracked `.env`:
   `ServiceConnections__SecretKey=<openssl rand -base64 32>` for `portal.api` and `portal.platformlistener`.
2. `docker compose up -d --build`.
3. Enable the feature flags `serviceconnection-security` (the security fields in the connection dialog)
   and `private-widgets` (widget import). Locally: insert rows into `featureflags` (website 1), then
   restart Portal.Api, because the config is cached in memory.
4. **Configure → Connections → Add connection**: module *Portal*, mode *Custom*, header `x-api-key`. Reopen
   it: the dialog shows *Custom* and `x-api-key: ********`. Saving unchanged keeps the stored key.
5. **Configure → Widgets management → Add private widget ▾ → Import**, pick
   `examples/service-connection-demo/service-connection-demo.zip`, then **Upload**.
6. **Home → Page configuration**: click an empty cell, pick *Service Connection Demo*, **add_widget**.
   Open its settings (gear), choose the connection, set a path, **Save**.
7. On the page, press **Send request**. The upstream receives the key; the browser never sees it:
   - the request carries the Portal token and `X-Portal-Widget-Instance`
   - the upstream receives `x-api-key` but no `Authorization` or cookies
   - the upstream's `Set-Cookie` and custom headers are stripped
   - the anonymous `api/v1/config/RouteWidgets/{id}` shows `********`

Verified negative cases on the live stack:
- 401 without a token, 400 without the instance header
- 404 for an unlinked connection or an unknown instance
- absolute URLs and encoded slashes in the path stay under the base URL
- a caller-sent `X-Api-Key` is overridden
- a masked save with no stored value is rejected (409)

## 5. Known gaps before this can ship

- **Page authorisation.** The proxy checks "logged-in user of this tenant" and "connection linked to this
  route widget", but **not** that the user may see the page the widget is on. Any logged-in user of the
  tenant who knows both ids can use the connection. This must reuse the route role check before
  production.
- **Anonymous pages.** The proxy is not available on anonymous pages (by design for the POC). Opening it
  would need a per-connection opt-in and rate limiting.
- **SSRF.** The admin chooses the base URL, which is trusted, but private and link-local IPs are not
  blocked, and the corporate `ProxyServer` config is not applied to the proxy client.
- **Key management.** There is one global key and no rotation (the `v1` prefix leaves room for it).
  Tenant export/import carries ciphertext, so the target environment needs the same key. Existing
  plaintext rows are encrypted only when saved again; a one-off migration job should re-save them.
- **Redis.** Route-widget responses cached before the deploy still contain the old unmasked values. Flush
  the `RouteWidgets` / `ServiceConnection` keys on deploy.
- **Gateway.** The `/api/v1/{everything}` Ocelot route has no `PATCH` in `UpstreamHttpMethod` (verified:
  404), and the gateway's per-route rate limit (10/s) applies. `SecurityDetectionMiddleware` scans proxied
  JSON bodies like any other request. The gateway normalises `..` before routing, so an encoded
  `a/%2e%2e/%2e%2e/x` never reaches the proxy; it lands on another Portal route with the user's own token.
- **Outgoing headers.** ASP.NET adds `x-correlation-id` and `traceparent` to the upstream call. They are
  harmless ids, but they do reach the third party.
- **Upstream URL is public.** `serviceConnections[].url` is still returned to anonymous visitors. Mask it
  too if connection URLs can be internal.
- **Encoded slashes.** A `%2F` inside a path segment reaches the upstream double-encoded (`%252F`). This is
  safe, but APIs that expect a literal `%2F` will not work.
- **Streaming.** Responses are streamed, but the request body is buffered by `StreamContent`, and there is
  no WebSocket or SSE support.
- **Admin UX.** The UI shows `********` in the input. Re-saving works, but a "value set / replace" control
  would be clearer. The module dropdown only offers fixed modules, so widget connections use *Portal*.
- **Found while testing, not caused by the POC.** `storage.api` kept serving the old bundle after a private
  widget was deleted and re-imported with the same tag, until it was restarted (in-memory cache).
- **Contract.** `docs/contract.md` §5a describes an endpoint that no released Portal has. Promote it to a
  normal section only once the backend change is merged.
