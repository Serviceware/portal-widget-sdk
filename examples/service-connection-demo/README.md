# service-connection-demo (experimental)

A widget that calls a third-party API **without ever holding its API key**. The key sits in a Portal
Service Connection. The widget calls `ctx.service('weather')('forecast?city=Bonn')`, and the Portal adds the
key on the server. Design, backend branch and known gaps: [docs/service-connection-proxy.md](../../docs/service-connection-proxy.md).

> Needs a Portal backend with the proxy proof of concept (`portal-backend` branch
> `poc/widget-connection-proxy`). On a released Portal the request returns 404.

```bash
pnpm install && pnpm build          # repository root first: the example imports the built SDK
cd examples/service-connection-demo
pnpm install
pnpm dev                            # http://localhost:4204, mock Portal + mock proxy
pnpm build && pnpm pack:widget      # service-connection-demo.zip for a real Portal
```

In the harness, the right-hand log shows every request that leaves the page. It carries the Portal token
and `X-Portal-Widget-Instance`, never the API key. The mock upstream reports `apiKeyAccepted: true` and
`portalTokenReachedUpstream: false`. Use the header buttons to see what happens when the user is anonymous
(401) or the connection is not linked (`ServiceConnectionNotFoundError`, no request sent).

`customConfig` holds only `{ connection, path }`: a connection id and a path. Both are public and
harmless. The settings view lists the tenant's connections through `ctx.fetch('api/v2/admin/serviceconnections')`
(admin only) and links the chosen one with `ctx.save(config, { serviceConnectionsId: [id] })`.
