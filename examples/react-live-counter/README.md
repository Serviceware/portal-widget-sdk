# react-live-counter

A Portal private widget written with **React 19 and TypeScript** on `@serviceware/portal-widget-sdk`. It
is deliberately a *changing* widget: a counter that ticks on its own, a clock, a progress bar towards a
configurable target, and a React settings form for the Portal's settings dialog. Use it to see how a
component framework with its own state and render cycle sits on top of the SDK's plain-DOM contract.

## What it shows

| Question | Answer in this example |
|---|---|
| Where does React mount? | `createRoot(ctx.root)` in `src/main.tsx`. `ctx.root` is the element itself in light mode and the shadow root in shadow mode; both are valid React containers. One React root per element instance (the tile and the Portal's settings-dialog instance are separate elements). |
| How does React learn about Portal input changes? | `ctx.inputs` is mutated in place, so `src/portal-store.ts` turns `onInputsChange` into an immutable snapshot behind `useSyncExternalStore`. `useInputs()` re-renders exactly when the Portal sets a property; the footer counts the batches and names the last changed inputs. |
| Settings? | `src/SettingsForm.tsx` is a normal controlled React form. Submit calls `ctx.save(settings)`, Cancel calls `ctx.cancel()`. `withDefaults` + a `sanitize` step clamp whatever is saved. |
| Toasts, settings button, resize, hidden | `ctx.toast.success` when the target is reached, `ctx.openSettings()` behind `showSettingsButton`, `ctx.onResize` in a `useEffect`, and the `hidden` input stops every timer. |
| CSS | A flat `src/styles.css`, scoped by `build.mjs` to `[react-live-counter]` inside `@layer widgets`. React injects no styles, so light mode works without any extra rule. The accent colour is a CSS custom property set inline per instance. |
| Build | esbuild bundles React and the JSX into one classic IIFE; `process.env.NODE_ENV` is pinned to `production`. About 240 kB minified, nearly all of it React. |

Settings (`customConfig`, public to every page visitor): title, step, tick interval (0 = manual), target,
accent colour, clock on/off. Texts are inline for `en` and `de` (`src/i18n.ts`); the three.js example shows
the translation-file route instead.

## Run it

```bash
pnpm install          # repository root
pnpm build            # builds packages/sdk and packages/cli (the example needs both dists)
cd examples/react-live-counter
pnpm install          # this folder is its own pnpm project, linked to ../../packages/*
pnpm dev              # rebuilds on change and serves http://localhost:4202
```

The harness in `dev/` is the same Portal mock as in `serviceware-logo-three` (loads the bundle as a
classic script, sets all fourteen inputs, mock toasts, settings dialog, skeleton, resize, compliance
probe). Try: change the language while the counter runs, tick **hidden** to pause it, open **Settings**,
save a shorter interval and watch the running instance pick it up without remounting.

## Build and pack for a Portal

```bash
pnpm build            # tsc --noEmit, then bundles/react-live-counter-1.0.0-{full,light}.js
pnpm validate         # portal-widget validate portal-widget.json
pnpm pack:widget      # -> react-live-counter.zip
```

## Notes

- `StrictMode` is on. In the production build it has no cost; in a dev build it would double-invoke
  effects, which the timers tolerate because every effect cleans up.
- Runtime CSS-in-JS (emotion, styled-components) is not used and would break light mode
  (docs/css-isolation.md). If you need it, build with `--css-mode shadow` and point the library at
  `ctx.root`.
- No source maps, dev builds are minified like release builds, so `pack` never picks up a different
  artefact than the one you tested.
