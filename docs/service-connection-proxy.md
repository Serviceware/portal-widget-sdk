# Service Connection proxy

A widget calls a third-party API that needs an API key, password or client secret, **and the credential
never reaches the browser**. The Portal holds it in a Service Connection, encrypted at rest, and adds it
server-side.

**Requires Portal 3 with the Service Connection proxy.** No Portal version number is assigned to it yet. On
a Portal without the proxy, `ctx.service()` gets a 404 and [security.md](security.md) tiers 2 and 3 are the
only options. The wire contract is [contract.md](contract.md) §5a.

---

## 1. Flow

```
widget (browser)                      Portal API                              third-party API
────────────────                      ──────────                              ───────────────
ctx.service('weather')('forecast?city=Bonn')
  GET {apiUrl}/api/v1/proxy/{connectionId}/forecast?city=Bonn
  Authorization: Bearer <Portal token>     (only when logged in)
  X-Portal-Widget-Instance: <configuration.id>   ─►  1. connection linked to that route widget,
                                                         same tenant?
                                                      2. logged in: may the user see the page?
                                                         anonymous: allowAnonymous + public page?
                                                         otherwise 404
                                                      3. drop Authorization, Cookie, X-Forwarded-*, ...
                                                      4. add the credential (mode)  ─►  GET {connection.url}/forecast?city=Bonn
                                                      5. copy allowlisted response headers ◄─  200 {...}
  ◄─ 200 {...}
```

## 2. Setting it up (admin) and what the widget stores

1. The admin creates the connection in **Portal Admin → Configure → Connections**: base URL plus a mode.
   From the widget author's view the modes are:

   | Mode | Use it when the third party wants … |
   |---|---|
   | `Custom` | an API key in a header (`x-api-key: …`) or a query parameter (`?appid=…`) |
   | `BearerToken` | a fixed `Authorization: Bearer <token>` |
   | `Basic` | a technical user with username and password |
   | `OAuth2ClientCredentials` | an OAuth 2.0 client (token URL, client id, client secret, optional scope/audience); the Portal fetches and caches the access token |
   | `ForwardUserToken` | the logged-in user's Portal token, e.g. for your own backend that trusts the Portal's identity provider; never on anonymous pages |
   | `None` | nothing; the proxy only hides the base URL and applies the allowlists |

   `Allow anonymous` lets the connection be used from public pages (not for `ForwardUserToken`).
   Anonymous calls are rate limited.
2. In the widget's settings dialog the admin picks the connection. The widget's settings view lists
   candidates with `ctx.fetch('api/v2/admin/serviceconnections')` (admin only, values masked) and saves with
   `ctx.save(customConfig, { serviceConnectionsId: [id] })`. That link is what the proxy checks.
3. `customConfig` holds only the connection id (or name) and maybe a path. Both are public and harmless.
   Never put the credential in `customConfig` or a `secret: true` field: those end up in the browser.

## 3. SDK surface

```ts
// inside definePortalWidget render(ctx)
ctx.serviceConnections();                          // [{ id, name, module, mode, modeName, isDefault, hasCredentials, allowAnonymous, url }]
const weather = ctx.service('weather');            // connection name or id, as linked to this instance
const res = await weather('forecast?city=Bonn');   // path relative to the connection URL
if (res.status === 429) {
    const seconds = Number(res.headers.get('Retry-After') ?? 60);
    // show "try again later"; the SDK never retries on its own
}
```

Standalone: `createServiceClient(() => ({ apiUrl, authToken, configuration }), 'weather')` and
`listServiceConnections(configuration)`. The client rejects with `ServiceConnectionNotFoundError` when the
connection is not linked (nothing is sent), and with `TypeError` for absolute URLs or `.`/`..` segments.
Every proxy answer comes back as the `Response`, unchanged. The proxy's own errors (`400`, `401`, `404`,
`429`, `502`, `504`, see [contract.md](contract.md) §5a) are `application/problem+json`; an upstream may
answer with the same statuses and content type, so treat any non-2xx as "the call failed" and show a
neutral message. Respect `Retry-After` on `429` and `503`. Without a Portal token the request goes out with
no `Authorization` header, which works only for connections with `allowAnonymous`.

Contract constants: `SERVICE_PROXY_PATH`, `WIDGET_INSTANCE_HEADER`, `serviceProxyPath()`,
`SERVICE_PROXY_STATUS`, `SERVICE_PROXY_LIMITS`, `MASKED_SECRET_VALUE`. Details: [sdk.md](sdk.md) §5a.

## 4. Try it

Run `examples/service-connection-demo` with `pnpm dev` (http://localhost:4204). Its dev server mocks the
proxy with the same rules: instance header required, link checked, anonymous calls only for a connection
with `allowAnonymous` and rate limited (429 with `Retry-After`), caller credentials dropped, the key added
server-side. The demo key exists only in the Node process, and the page log shows every request that
leaves the browser.

Against a Portal with the proxy: create a connection, import the demo zip
(`pnpm build && pnpm pack:widget`), place the widget on a page, link the connection in its settings and
press **Send request**. The browser's network tab shows the Portal token and `X-Portal-Widget-Instance`,
never the key; the anonymous config endpoints show `********`.

## 5. Limits

- No WebSocket or Server-Sent Events.
- The request body is buffered, not streamed; request and response are capped at 10 MB.
- 30 s timeout per call; redirects are not followed.
- Only allowlisted request and response headers pass ([contract.md](contract.md) §5a).
- A `%2F` inside a path segment reaches the upstream double-encoded (`%252F`).
- Key rotation of the Portal's encryption key is not supported yet. Tenant export/import carries no secret
  values; admins re-enter them after an import.
