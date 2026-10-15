---
"@serviceware-oss/portal-widget-sdk": minor
---

Add Service Connection support for Portal 3 with the Service Connection proxy. A widget calls a
third-party API through the Portal, which adds the connection's credential server-side, so no secret
reaches the browser.

- `ctx.service(idOrName)` / `createServiceClient(getSource, idOrName)` send requests to
  `{apiUrl}/api/v1/proxy/{connectionId}/{path}` with `X-Portal-Widget-Instance`, and with the Portal token
  only when the user is logged in (anonymous pages work for connections the admin allowed for anonymous use).
  The `Response` is returned unchanged; nothing is retried. `ServiceConnectionNotFoundError` when the
  connection is not linked to the instance.
- `ctx.serviceConnections()` / `listServiceConnections(configuration)` return
  `{ id, name, module, mode, modeName, isDefault, hasCredentials, allowAnonymous, url }` for the linked
  connections, never any header, query, password or secret value.
- `ctx.save(customConfig, { serviceConnectionsId })` (new `SaveOptions`) links connections to the instance.
- `SecurityModes` gains `Basic`, `OAuth2ClientCredentials` and `ForwardUserToken`; `ServiceConnectionSecurity`
  gains `queryParameters`, `basic`, `oAuth2` and `allowAnonymous`; `ServiceConnection.url` may be `null`.
- Contract constants `SERVICE_PROXY_PATH`, `WIDGET_INSTANCE_HEADER`, `serviceProxyPath()`,
  `SERVICE_PROXY_STATUS`, `SERVICE_PROXY_LIMITS`, `MASKED_SECRET_VALUE`, plus `resolveServiceConnection`.
