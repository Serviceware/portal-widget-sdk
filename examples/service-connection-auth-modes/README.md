# service-connection-auth-modes

Six test widgets, **one per Service Connection security mode**, and a local test API that checks what the Portal
proxy sends. Each widget calls its linked connection through the real proxy and shows **PASS** or **FAIL** with
the reason. The widgets never hold a credential: the admin types the test credentials into the connections,
and the Portal adds them server-side. Background: [docs/service-connection-proxy.md](../../docs/service-connection-proxy.md).

| Widget tag | Mode | Connection base URL (as the Portal server reaches the test API) | What the admin enters |
|---|---|---|---|
| `auth-mode-none` | None | `http://host.docker.internal:4310/none` | nothing |
| `auth-mode-bearer` | BearerToken | `http://host.docker.internal:4310/bearer` | token `test-bearer-token` |
| `auth-mode-custom` | Custom | `http://host.docker.internal:4310/custom` | header `x-api-key` = `test-api-key`, query parameter `appid` = `test-app-id` |
| `auth-mode-basic` | Basic | `http://host.docker.internal:4310/basic` | user `portal-test`, password `test-basic-password` |
| `auth-mode-oauth` | OAuth2ClientCredentials | `http://host.docker.internal:4310/oauth` | token URL `http://host.docker.internal:4310/oauth/token`, client `portal-test-client`, secret `test-client-secret`, scope e.g. `widgets.read` |
| `auth-mode-forward` | ForwardUserToken | `http://host.docker.internal:4310/forward` | nothing (the signed-in user's token is forwarded) |

These are test values for a local test API, not secrets; change them with the `TEST_*` environment variables
listed in `modes.mjs`. `pnpm build` refuses a bundle that contains any of them.

> Needs Portal 3 with the Service Connection proxy and `ServiceConnections:SecretKey` configured; without the key,
> saving a connection with a credential answers 409 and the proxy 502. The proxy must be allowed to reach the
> test API: a private address such as `host.docker.internal` works only with
> `ServiceConnections:Proxy:BlockPrivateNetworks` off (the default outside SCE).

## Run

```bash
pnpm install && pnpm build             # repository root first: the example links the built SDK and CLI
cd examples/service-connection-auth-modes
pnpm install
pnpm build && pnpm pack:widgets        # dist/auth-mode-<mode>.zip, one per widget
pnpm upstream                          # test API on http://127.0.0.1:4310 (keep it running)
```

### Automated check (no UI)

```bash
PORTAL_API_URL=http://localhost:61208 PORTAL_TOKEN=<admin access token> pnpm e2e
```

Creates the connections `auth-test-<mode>` when missing (they stay for the UI test), places a temporary widget
instance per mode, calls the proxy as a widget would, and removes the instances. It also checks that the admin
API masks every secret, that the widget configuration carries none, and that an unlinked instance, an anonymous
caller and a call without `X-Portal-Widget-Instance` are refused. `UPSTREAM_URL` overrides the test API address
the Portal server uses. Take the token from a signed-in admin session (browser dev tools, `Authorization` header
of an API call); the script never prints it.

### In the Portal UI

1. **Connections** (Portal Admin → Configure → Connections): one connection per row of the table above, or run
   `pnpm e2e` once, which creates them as `auth-test-<mode>`.
2. **Import** each `dist/auth-mode-<mode>.zip` (Portal Admin → Configuration → Widgets → Import).
3. Place the six widgets on a page, open each widget's settings and choose the matching connection. Saving links
   the connection to that widget instance, which is what the proxy checks.
4. Press **Run test** in each widget. Every widget should show **PASS**. A widget also warns when the linked
   connection has a different mode.

The test API's window logs every request with the verdict; it never logs a credential. A FAIL that says the Portal
token reached the upstream means the proxy forwarded the caller's `Authorization` header: a security bug.
