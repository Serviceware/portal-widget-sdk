# Compatibility

Which Portal versions a widget built with a given SDK and CLI version runs on. `@serviceware-oss/portal-widget-sdk`
and `@serviceware-oss/portal-widget-cli` are released together with the same version number.

**Rule: the latest SDK is always compatible with the latest Portal in the Serviceware cloud.** On-premise
installations get new Portal features with their next update, so a feature added for the cloud (marked below)
can be missing on an older on-premise Portal. The rest of the SDK keeps working there.

## Chart

| SDK / CLI | Portal 2.3 (on-premise, 2.3.0–2.3.4) | Portal 3.0 (on-premise, 3.0.x) | Portal 3 in the cloud (latest) |
|---|---|---|---|
| **0.2.0** (next) | ✅ with `cssMode: 'shadow'` · ❌ `ctx.service()` | ✅ · ❌ `ctx.service()` | ✅ everything |
| **0.1.1** | ✅ with `cssMode: 'shadow'` | ✅ | ✅ |
| **0.1.0** | ✅ with `cssMode: 'shadow'` | ✅ | ✅ |

0.1.1 changed only the release pipeline; its runtime is the same as 0.1.0.

## Per feature

| Feature | SDK | Portal 2.3 | Portal 3.0 | Cloud |
|---|---|---|---|---|
| Custom element, inputs (`configuration`, `authToken`, `apiUrl`, `settingsMode`, `isAdminMode`, `language`), settings save/cancel, toasts, navigate, skeleton, resize | 0.1.0 | ✅ | ✅ | ✅ |
| `ctx.fetch` to the Portal API with the user's token | 0.1.0 | ✅ | ✅ | ✅ |
| Private widget upload and ZIP import (`portal-widget pack`) | 0.1.0 | ✅ | ✅ | ✅ |
| `cssMode: 'shadow'` (styles in the shadow root) | 0.1.0 | ✅ | ✅ | ✅ |
| `cssMode: 'light'` (styles scoped to `[<tag>]` in `@layer widgets`) | 0.1.0 | ❌ styles do not apply: the Portal does not mark the widget host with `[<tag>]` and has no `widgets` layer | ✅ | ✅ |
| `ctx.serviceConnections()` (linked connections, no secrets) and linking with `ctx.save(config, { serviceConnectionsId })` | 0.2.0 | ✅ | ✅ | ✅ |
| `ctx.service(id)(path)`: calls through the Service Connection proxy, credential added by the Portal | 0.2.0 | ❌ 404 | ❌ 404 | ✅ |

A widget that should run everywhere uses `cssMode: 'shadow'` and treats `ctx.service()` as optional: on a Portal
without the proxy the request answers 404, so show a neutral "not available on this Portal" message instead of
an error. Never fall back to putting a credential into the widget configuration
([security.md](security.md)).

The `dependencies` entry the CLI writes (`Portal >=3.0.0`) is shown to the admin but not enforced: a 2.3 Portal
accepts the widget anyway.

## How this was checked

On 2026-11-04 against the Portal sources of the 2.3 line (release 2.3.4 and its servicing branch), the 3.0 line
(release 3.0.0 and its servicing branch) and the current cloud release: event names and `SSPEvent` suffix,
element inputs and outputs, the bundle URL and the full/light choice (`angularVersion: 0` always loads the full
bundle), the private widget upload and ZIP import, the widget host attribute and the CSS layer order, the
connection link on route widgets, and the Service Connection proxy. All six proxy security modes were run end to
end against a local Portal built from the current cloud release, with `examples/service-connection-auth-modes`
(`pnpm e2e`). The contract
itself: [contract.md](contract.md), sources: [reference-sources.md](reference-sources.md).

Update this page with every release, and when an on-premise Portal update ships a cloud-only feature.
