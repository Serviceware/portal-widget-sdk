# CLI port from SSP_Portal

`packages/cli` is a port of the private widget toolkit built in the `SSP_Portal` monorepo on branch
`feature/private-widget-toolkit` (commit `b47f4036`, Nx library `libs/create-widget`, published there as
the `ssp-widget` binary). This page records what moved, what changed on the way, what deliberately stayed
behind, and which decisions the port leaves open. The original author's handover, with the design
decisions and the traps, is reproduced in [handover-private-widget-toolkit.md](handover-private-widget-toolkit.md).

**Ground rule applied:** this repository has no dependency on private artifacts. Nothing under
`packages/` references `@ssp/*`, `@codeblue/*`, `@sw/*` or the internal Azure Artifacts feeds, at install,
build, test or run time. The one part of the toolkit that could not meet that rule, the Angular/CodeBlue 3
project scaffold, was not ported.

## What the CLI does

| Command | Purpose |
|---|---|
| `portal-widget` (no args) | Wizard. `embed`: two questions (display name, URL) produce an import-ready ZIP with no code and no build. `custom`: one question writes a `template: "custom"` config naming where the author's own bundles must land. |
| `portal-widget pack [--config] [--out]` | `portal-widget.json` in, `<tagName>.zip` out. Refuses anything `validate` would reject. |
| `portal-widget validate <config or zip>` | Per-field report mirroring the upload dialog's enforced rules. |
| `portal-widget unpack <zip> [--out] [--force] [--with-bundles]` | Recover an editable config from any ZIP, including one the Portal exported. |

Full behaviour, ZIP layout and the reasoning behind the `portal-widget.json.txt` sidecar are in
[`packages/cli/README.md`](../packages/cli/README.md).

## File map

Everything under `libs/create-widget/` in SSP_Portal, and where it landed here.

| SSP_Portal | This repository | Change |
|---|---|---|
| `src/cli/index.ts` | `packages/cli/src/cli/main.ts` | CommonJS self-run block removed; `src/bin.ts` (new) is the shebang entry and calls `main()`. `new` command removed (scaffold not ported). |
| `src/cli/embed-bundle-resolver.ts` | `packages/cli/src/cli/embed-bundle-resolver.ts` | Resolves `assets/embed/ng<major>` from `PACKAGE_ROOT` instead of `__dirname/../..`. |
| `src/index.ts` | `packages/cli/src/index.ts` | `scaffold` export removed. |
| `src/lib/package-identity.ts` | `packages/cli/src/lib/package-identity.ts` | Package name `@serviceware/portal-widget-cli`, bin `portal-widget`, config file `portal-widget.json`, ZIP sidecar `portal-widget.json.txt` (were `ssp-widget*`). |
| `src/lib/wizard.ts` | `packages/cli/src/lib/wizard.ts` | Custom branch no longer scaffolds a project; it writes a `template: "custom"` config with `angularVersion: 0` and bundle paths under `bundles/`, then tells the author to build and `pack`. |
| `src/lib/output.ts` | `packages/cli/src/lib/output.ts` | `wizard-custom` message reworded for the above (config path, both bundle paths, tag to register). |
| `src/lib/{config,metadata,pack,prelude,rules,slugify,unpack,validate}.ts` | `packages/cli/src/lib/` | Unchanged (one comment in `rules.ts` reworded). |
| `src/lib/*.spec.ts` (Jest) | `packages/cli/src/lib/*.spec.ts` (vitest) | Explicit `vitest` imports, `vi.spyOn`, `MockInstance`; `__dirname` paths re-rooted. Assertions untouched except the wizard's custom-path cases, rewritten for the new behaviour. |
| `src/lib/rules-drift.spec.ts` | same | Reads `reference/ssp-portal/{widget-management-add-private-widget-dialog.component.ts,portal-validators.ts}` (new snapshots) instead of the live Portal sources. |
| `src/lib/portal-contract.spec.ts` | **not ported** | Needs Angular `TestBed` and the real `WidgetPackageService`. See below. |
| `src/lib/scaffold.ts`, `scaffold.spec.ts`, `scaffold-template.spec.ts` | **not ported** | The Angular/CB3 project generator. See below. |
| `assets/scaffold/**` | **not ported** | Templates depend on `@ssp/utils`, `@ssp/core`, `@codeblue/*`; `.npmrc` names the internal feed. |
| `assets/embed/ng22/embed-widget-1.0.0-{full,light}.js` | `packages/cli/assets/embed/ng22/` | Byte-identical copies. Shipped artifacts, not a dependency: `pack` prepends a prelude and never compiles anything. |
| `tools/refresh-embed-assets.mjs` | `packages/cli/tools/refresh-embed-assets.mjs` | Builds in an SSP_Portal checkout given by `SSP_PORTAL_DIR` / `--portal`, copies into this package's `assets/`. Maintainer-only. |
| `tools/verify-scaffold-build.mjs` | **not ported** | End-to-end proof for the scaffold; needs the internal feed. |
| `README.md` | `packages/cli/README.md` | Rewritten around the two paths that remain. |
| `project.json`, `jest.config.ts`, `tsconfig.*`, `eslint.config.mjs`, `test-setup.ts` | replaced | `tsup.config.ts`, `vitest.config.ts`, package `tsconfig.json`, root `eslint.config.mjs`. |
| `.claude/agents/private-widget-toolkit.md` (gitignored there) | `docs/handover-private-widget-toolkit.md` | Frontmatter stripped, preface added. |

## Toolchain changes

| Aspect | SSP_Portal | Here |
|---|---|---|
| Module format | CommonJS (`@nx/js:tsc`) | ESM, bundled by tsup into `dist/index.js` + `dist/bin.js` |
| Tests | Jest via `jest-preset-angular` (needed for the contract spec) | vitest, node environment |
| Asset lookup | `__dirname/../../assets` | `PACKAGE_ROOT/assets` (`src/package-root.ts`); `assets/` ships next to `dist/`, listed in `files` |
| Runtime deps | `fflate`, `tslib` | `fflate` only |
| Type strictness | monorepo base | `strict` plus `noImplicitReturns`/`noFallthroughCasesInSwitch`; the skeleton's `noUncheckedIndexedAccess` was dropped because the ported code was not written against it |

Verified after the port: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (130 specs) in
`packages/cli`, plus an end-to-end run of the built binary: embed wizard to ZIP, `validate`, `unpack`
(byte-identical config), and the custom wizard to config, hand-written bundles, `pack`, `validate`.

## Stayed in SSP_Portal, and why

- **The Angular/CodeBlue 3 scaffold** (`ssp-widget new`, `assets/scaffold/`, `verify-scaffold-build.mjs`
  and the two scaffold specs). Every generated project installs `@ssp/utils`, `@ssp/core` and `@codeblue/*`
  from the internal feed and builds through `@ssp/utils`'s shared widget scripts. There is no private-free
  version of that: CodeBlue is the design system, and the CSS-isolation wiring lives in `@ssp/utils`. It
  remains a Portal-internal tool on the `feature/private-widget-toolkit` branch. This repository's answer
  for custom widgets is the framework-agnostic path: the wizard's `custom` branch plus the runtime SDK in
  `packages/sdk` ([sdk.md](sdk.md), [contract.md](contract.md)).
- **`widgets/embed-widget/`** (the Angular widget the embed path ships prebuilt). It builds through the
  monorepo's Nx pipeline and its shared widget build scripts. Only its built bundles live here, as
  `assets/embed/ng22/`. Refresh them with `pnpm refresh-embed-assets` pointed at a Portal checkout.
- **`portal-contract.spec.ts`**. Its whole value is unpacking our ZIP through the Portal's *real*
  `WidgetPackageService`; a reimplementation would prove nothing. It belongs on the Portal side, which is
  already a Phase 4 item in [plan.md](plan.md) ("`widget-package.service.spec.ts` case that unpacks a zip
  fixture produced by the CLI"). Until that lands, this guarantee is only covered by the specs in
  SSP_Portal's `feature/private-widget-toolkit` branch.
- **Portal-side changes on that branch** (`libs/utils` CSS-isolation plugin, `.scripts/rename-widget.js`,
  `widgets/widget-metadata.schema.json`, docs). They are Portal code; the parts the CLI depends on are
  snapshotted under `reference/ssp-portal/`.

## Ground rules, status after the port

1. ~~Private packages and the internal feed.~~ Resolved by not porting the scaffold. The only remaining
   contact with the monorepo is `tools/refresh-embed-assets.mjs`, a maintainer script that needs a local
   SSP_Portal checkout and is never run at install, build, test or run time.
2. **Two CLI designs.** [cli.md](cli.md) specifies `init`/`build`/`release`/`pack` for a framework-agnostic,
   esbuild-based flow. The ported CLI implements the wizard/`pack`/`validate`/`unpack` flow around a
   hand-written `portal-widget.json`. `pack`, `validate` and the ZIP contract overlap and should converge on
   the ported implementation, which is proven against the Portal's real reader. A future `init`/`build`
   would slot in ahead of the wizard's custom branch, producing the bundles it currently asks the author for.
3. ~~Config file naming.~~ Done: `portal-widget.json` / `portal-widget.json.txt`. The `.json.txt` sidecar
   reasoning from the handover still holds for the new stem (`portal-widget` also canonicalises as a
   locale). Not renamed: the `ssp-` prefix `slugifyTag` puts on every derived tag, and the
   `__SSP_WIDGET_DEF__` prelude global, which is baked into the prebuilt embed bundles.
4. ~~Angular in v1.~~ Resolved with 1: no Angular preset ships from here.

One judgement call worth stating: the embed bundles in `assets/embed/ng22/` are compiled from Angular
and CodeBlue sources in SSP_Portal. They contain no package references npm could resolve and the Portal
serves them as opaque scripts, so they meet the rule as stated. If the intent is "no CodeBlue-derived
bytes at all", the embed path has to go too.

## Outstanding work carried over from the handover

- One command to bump the version in `widget-metadata.json`, `portal-widget.json` and `package.json`
  (the first applies to Portal-built widgets; for this CLI the config and the bundle file names must agree).
- Document updating an already-uploaded widget (Import refuses duplicate tags by design; use Edit, or
  delete and re-import). Now in `packages/cli/README.md`, "What `validate` deliberately does NOT check".
- Portal-side `portal-contract` spec (above).
- Scaffold items (ship `pnpm-workspace.yaml`, a `super(widgetTranslations)` guard test) stay with the
  scaffold in SSP_Portal.

## Portal defects found while building the toolkit (not caused by it)

Recorded in the handover; each deserves its own ticket in the Portal backlog.

1. `FeatureFlagsService` treats `[]` as loaded, so deep-linking to a flag-gated page hides the feature.
2. Language-file picker advertises 5 MB, the Upload gate enforces 1 MB, with no explanation in between.
3. `build:<widget>:full && build:<widget>:light` deletes the full bundle (shared `outputPath`).
4. `widgets_management_import_private_widget` renders as a raw translation key.
