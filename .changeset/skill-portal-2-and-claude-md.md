---
"@serviceware-oss/portal-widget-cli": minor
---

Agent skill `portal-private-widget`: asks for the target Portal (Portal 3, Portal 2 or both) and applies its
conventions. Portal 2 builds use shadow-mode CSS, because Portal 2 does not stamp the `[<tag>]` host attribute
that light-mode CSS is scoped to, plus `Portal >=2.0.0` as dependency and the Portal 2 admin steps. The import
steps no longer require the `private-widgets` feature flag on Portal 3, which now enables private widgets for
every tenant; Portal 2 and early Portal 3.x releases still need it.
