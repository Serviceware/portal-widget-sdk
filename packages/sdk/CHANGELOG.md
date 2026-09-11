# @serviceware/portal-widget-sdk

## 0.1.0

### Minor Changes

- a962a14: Implement the Phase 1 runtime specified in `docs/sdk.md`: `showToast`/`toast`, `showConfiguration`,
  `navigate`, `showSkeleton`/`hideSkeleton`, `onWidgetResize`; `saveConfiguration` (with the `secret`
  guard, `SecretInConfigError`) and `cancelConfiguration`; `createPortalFetch` with an origin-safe `apiUrl`
  prefix check; `definePortalWidget` (input batching, render after the first `configuration`, shadow and
  light style injection, cleanup on disconnect); `defineConfigSchema`, `withDefaults` and `debugConfig`.
  Covered by jsdom specs asserting the exact event names and payload shapes from `docs/contract.md`.
