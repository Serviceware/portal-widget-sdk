# serviceware-logo-three

The Serviceware icon extruded in 3D with [three.js](https://threejs.org/), packaged as a Portal private
widget with `@serviceware/portal-widget-sdk`. It doubles as the SDK's end-to-end test: every runtime
feature is wired to a button, an input or a setting so it can be exercised in the dev harness and in a
real Portal.

## What it exercises

| SDK feature | Where |
|---|---|
| `definePortalWidget` (inputs batching, render after first `configuration`, cleanup on disconnect) | `src/main.ts` |
| `cssMode: 'light'` (default build) and `'shadow'` (`pnpm build:shadow`) | `build.mjs` scopes `src/styles.css` to `[serviceware-logo-three]` inside `@layer widgets` |
| `defineConfigSchema`, `withDefaults`, a `secret: true` field | `src/schema.ts`; the `apiKey` field exists only to prove `save()` refuses it |
| `ctx.save()` / `ctx.cancel()` in the settings dialog (`settingsMode`) | `src/settings-view.ts` |
| `ctx.toast.*` (all four severities), `ctx.openSettings()`, `navigate()`, `showSkeleton()` / `hideSkeleton()` | toolbar in `src/widget-view.ts` |
| `ctx.loadTranslations()` through `ctx.fetch` (bearer token only for `apiUrl`), `customTrans` overrides | `src/i18n.ts`, "Reload texts" button, language changes |
| `ctx.onResize()` plus a `ResizeObserver` for the canvas | inputs panel shows the last Portal resize event |
| `debugConfig()` redaction | "Log config" button writes the redacted configuration to the console |
| Reacting to `configuration`, `language`, `hidden`, `showSettingsButton` changes | `onInputsChange` in both views |

Settings (`customConfig`, public to every page visitor): icon colour, extrusion depth, rotation speed,
auto-rotate, wireframe, caption, and the deliberately unsaveable `apiKey`.

The `apiKey` field is there to show the guard, not to suggest a pattern: a widget currently has **no secure
way to use a private API key** (see the SDK README). The inputs panel lists linked Service Connections by
name only; their header values must never be rendered or logged.

## Run it

```bash
pnpm install          # repository root
pnpm build            # builds packages/sdk and packages/cli (the example needs both dists)
cd examples/serviceware-logo-three
pnpm dev              # rebuilds on change and serves http://localhost:4201
```

The harness at `dev/index.html` stands in for the Portal shell: it loads the bundle as a classic script,
sets all fourteen element inputs, renders toasts, opens a mock settings dialog on
`eventShowConfigModalSSPEvent`, applies `configurationSaved`, shows a skeleton, dispatches
`eventWidgetResizedSSPEvent` when you resize the tile, and runs a copy of the Portal's CSS compliance
probe. Its mock API serves `translations/*.json` only when a bearer token is present, so a widget that
bypasses `ctx.fetch` fails visibly. Use the header controls to change language, layout, admin/edition
mode, hidden, renew the token, re-set the configuration or detach and re-attach the element. "Save frame"
writes the widget canvas to `dev/last-frame.png` through the dev server, handy where screenshots are awkward.

## Build and pack for a Portal

```bash
pnpm build            # tsc --noEmit, then bundles/serviceware-logo-three-1.0.0-{full,light}.js
pnpm validate         # portal-widget validate portal-widget.json
pnpm pack:widget      # -> serviceware-logo-three.zip (plain `pnpm pack` is pnpm's own tarball command)
```

Import the zip in Portal Admin (Configuration, Widgets, split button, Import). Then open the browser
console and confirm there is no `[Widget Compliance]` warning. To iterate against a deployed Portal
without re-importing, override the bundle response in Chrome DevTools (docs/contract.md section 10).

## CSS mode

The default build is light mode because the Portal's compliance probe today only inspects
`document.styleSheets` (docs/css-isolation.md section 5). `build.mjs` implements the light-mode subset
of the CSS pipeline for a flat stylesheet: selector prefixing, `:host` mapping and the `@layer widgets`
wrapper. It rejects at-rules on purpose; keep `src/styles.css` flat. `pnpm build:shadow` produces a
shadow-DOM build for when the Portal-side probe change has shipped.

## Notes

- `three` is bundled into the widget (about 650 kB minified). Fine for the Portal's 10 MB bundle limit, but
  keep an eye on it if you add more of three's addons.
- The geometry comes from `serviceware-cookie.svg` (the round Serviceware icon, traced with potrace), inlined
  by `build.mjs`, parsed with three's `SVGLoader` and extruded. The model is normalised to 100 units on its
  larger side, so `depth` is in those units. The colour is configurable (default Serviceware orange); the
  look comes from a clear-coated physical material lit by three's `RoomEnvironment`. Swap the SVG to render
  any other single-colour mark.
- No source maps are emitted (docs/security.md section 4), and dev builds are minified like release builds so
  `pack` never picks up a different artefact than the one you tested.
