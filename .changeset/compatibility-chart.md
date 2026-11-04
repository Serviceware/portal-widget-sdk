---
"@serviceware-oss/portal-widget-sdk": patch
"@serviceware-oss/portal-widget-cli": patch
---

Document which Portal versions each release runs on (`docs/compatibility.md`, summary in the SDK README):
0.1.x and 0.2.0 run on the on-premise Portal 2.3 (with `cssMode: 'shadow'` and the `private-widgets` feature
flag) and 3.0, and in the cloud; `ctx.service()` needs the Service Connection proxy, which only the Portal in the
cloud has today. The latest SDK is always compatible with the latest Portal in the cloud.

The bundled `portal-private-widget` skill now names where the Service Connection proxy is available, links the
compatibility chart, and warns that a widget configuration's `serviceConnections[].security` holds the real
credentials while the admin keeps *Give credentials to widgets* on, so widgets must never read it.
