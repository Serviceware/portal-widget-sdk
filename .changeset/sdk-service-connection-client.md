---
"@serviceware/portal-widget-sdk": minor
---

Add the experimental `createServiceClient` and `ctx.service(nameOrId)`. They send widget requests to
`{apiUrl}/api/v1/proxy/{connectionId}/{path}` with the Portal token and `X-Portal-Widget-Instance`, so the
Portal injects the Service Connection's credentials server-side. This needs the Portal backend proof of
concept (docs/service-connection-proxy.md) and does not work on any released Portal yet. Also adds the
contract constants `SERVICE_PROXY_PATH`, `WIDGET_INSTANCE_HEADER` and `serviceProxyPath()`, plus
`resolveServiceConnection` and `ServiceConnectionNotFoundError`.

`ctx.save(customConfig, { serviceConnectionsId })` (new `SaveOptions`) lets a widget's settings view link
Service Connections to its instance.
