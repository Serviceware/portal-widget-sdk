---
"@serviceware-oss/portal-widget-cli": patch
---

The bundled `portal-private-widget` skill now routes private keys to a Portal Service Connection:
the admin stores the credential and links the connection in the widget settings, the widget keeps only the
connection id in `customConfig` and calls `ctx.service(id)(path)`; `ctx.serviceConnections()` lists linked
connections without secrets. Requires Portal 3 with the Service Connection proxy; without it the skill keeps
recommending a backend you control.
