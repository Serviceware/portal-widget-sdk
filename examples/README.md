# Examples

End-to-end example widgets built with `@serviceware/portal-widget-sdk`. Each one builds its bundles with
its own `build.mjs` (esbuild) and packs them with `portal-widget pack`.

The examples are **not** part of the repository's pnpm workspace. Each folder is its own pnpm project
(`pnpm-workspace.yaml` with `packages: [.]`) that links the local packages via `link:../../packages/*`,
so the root `pnpm install` stays limited to the SDK and CLI and none of React, Astro or three.js enters the
root lockfile. Install an example only when you want to run it.

| Example | What it shows |
|---|---|
| [`serviceware-logo-three/`](serviceware-logo-three/) | The Serviceware logo in 3D (three.js). Reference widget for every SDK runtime feature: settings UI in `settingsMode` with save/cancel and the secret guard, all toast severities, open-settings, navigate, skeleton, translations through the authenticated fetch, resize handling, `debugConfig`, light and shadow CSS modes. Ships a Portal-mock dev harness (`pnpm dev`) with a copy of the CSS compliance probe. |
| [`react-live-counter/`](react-live-counter/) | A changing widget in **React 19 + TypeScript**: self-ticking counter, clock, progress towards a target, React settings form. Shows the framework pattern the SDK expects: `createRoot(ctx.root)`, `onInputsChange` bridged into `useSyncExternalStore`, one React root per element instance, flat CSS scoped by the build. Harness on port 4202. |
| [`astro-static-card/`](astro-static-card/) | A static widget whose HTML and CSS are **pre-rendered by Astro** at build time, per language. No framework runtime in the bundle; the SDK runtime only sets `innerHTML`, picks the language variant and forwards link clicks to `navigate()`. Shows that the SDK needs nothing from a framework but DOM output. Harness on port 4203. |

Planned: a `lit/` variant.

```bash
pnpm install && pnpm build      # repository root: the examples import the built package dists
pnpm install:examples           # or `pnpm install` inside one example folder
pnpm build:examples             # or `pnpm build` inside one example folder
cd examples/serviceware-logo-three && pnpm dev     # or react-live-counter, astro-static-card
```

`pnpm lint:examples` at the root lints all examples with the repository's ESLint config.

Manual end-to-end test against a Portal (docs/plan.md, Phase 3): `pnpm build`, `pnpm pack:widget`, import the
zip in Portal Admin, confirm toasts and the config modal work and there is no `[Widget Compliance]`
warning, and that Portal styles are unchanged.
