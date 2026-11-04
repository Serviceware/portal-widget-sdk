# service-connection-demo

A widget that calls a third-party API **without ever holding its API key**. The key sits in a Portal
Service Connection. The widget calls `ctx.service(connectionId)('forecast?city=Bonn')`, and the Portal adds
the key on the server. `ctx.serviceConnections()` shows what the widget may know about its linked
connections: name, mode and flags, never a secret. Design and limits:
[docs/service-connection-proxy.md](../../docs/service-connection-proxy.md).

> Needs Portal 3 with the Service Connection proxy. On a Portal without it the request returns 404.

```bash
pnpm install && pnpm build          # repository root first: the example imports the built SDK
cd examples/service-connection-demo
pnpm install
pnpm dev                            # http://localhost:4204, mock Portal + mock proxy
pnpm build && pnpm pack:widget      # service-connection-demo.zip for a real Portal
```

In the harness, the right-hand log shows every request that leaves the page. It carries the Portal token
(when logged in) and `X-Portal-Widget-Instance`, never the API key. The mock upstream reports
`apiKeyAccepted: true` and `portalTokenReachedUpstream: false`. Two connections are linked: `weather`
(logged-in users only) and `public-weather` (anonymous use allowed). Header buttons:

- **toggle anonymous**: no token is sent. `weather` now answers 404; `public-weather` works, and after five
  calls within a minute the mock answers 429 with `Retry-After`. The connection `url` is hidden, as the
  Portal does for anonymous visitors.
- **switch connection**: toggles between the two connections.
- **toggle linked connections**: nothing linked, so `ctx.service()` throws `ServiceConnectionNotFoundError`
  and no request is sent.

`customConfig` holds only `{ connection, path }`: a connection id and a path. Both are public and
harmless. The settings view lists the tenant's connections through `ctx.fetch('api/v2/admin/serviceconnections')`
(admin only) and links the chosen one with `ctx.save(config, { serviceConnectionsId: [id] })`.
