# Examples

End-to-end example widgets built with `@serviceware/portal-widget-sdk`. Each one is a workspace package
that builds its bundles with its own `build.mjs` (esbuild) and packs them with `portal-widget pack`.

| Example | What it shows |
|---|---|
| [`serviceware-logo-three/`](serviceware-logo-three/) | The Serviceware logo in 3D (three.js). Reference widget for every SDK runtime feature: settings UI in `settingsMode` with save/cancel and the secret guard, all toast severities, open-settings, navigate, skeleton, translations through the authenticated fetch, resize handling, `debugConfig`, light and shadow CSS modes. Ships a Portal-mock dev harness (`pnpm dev`) with a copy of the CSS compliance probe. |

Planned: `react/`, `lit/` variants of a smaller widget once the SDK API has settled.

```bash
pnpm install
pnpm build              # packages first: the examples import the built dists
pnpm build:examples
cd examples/serviceware-logo-three && pnpm dev
```

Manual end-to-end test against a Portal (docs/plan.md, Phase 3): `pnpm build`, `pnpm pack:widget`, import the
zip in Portal Admin, confirm toasts and the config modal work and there is no `[Widget Compliance]`
warning, and that Portal styles are unchanged.
