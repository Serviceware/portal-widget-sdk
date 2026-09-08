# Plan

## Decisions taken

| Topic | Decision | Why |
|---|---|---|
| Repository | Separate, public, GitHub. Local only for now. | Portal tooling depends on private feeds; the contract is plain DOM. |
| Packages | Two: `sdk` (browser, zero deps) and `cli` (node). One pnpm workspace. | Runtime must stay tiny; CLI pulls node deps. |
| Framework support | Framework-agnostic. Vanilla TS example first, React/Lit examples later. No Angular preset in v1. | Angular customers cannot obtain CodeBlue anyway; Angular build path duplicates `@ssp/utils`. |
| CSS | Two modes, `shadow` default, `light` fallback. Build-time scoping + `@layer widgets` always. | See css-isolation.md. |
| Secrets | Server-held via Service Connections (needs backend proxy), public keys only in `customConfig`, build-time secret scan, env allowlist. | See security.md. |
| Language | TypeScript strict, ESM first. | |
| Build | tsup (sdk: esm+cjs+dts; cli: esm + shebang bin). | Simple, fast. |
| Tests | vitest; jsdom for sdk. | |
| Versioning | changesets; independent versions per package. | |
| Publishing | GitHub Actions, `npm publish --provenance --access public`, OIDC trusted publishing. | Supply-chain verifiability. |
| License | MIT. | Matches `@ssp/utils`. |
| Node | ≥ 20. | |

## Open decisions (owner: Portal team)

1. ~~npm scope~~ **Confirmed: `@serviceware`.** Still open: the GitHub organisation that hosts the public
   repository, and who administers the npm organisation for trusted publishing (release.yml).
2. ~~Service connection proxy exists?~~ **Answered: no usable proxy** (backend-findings.md §1). Decide
   whether to build the proxy (§4) before or after SDK v1. SDK v1 ships without Tier 1 either way.
3. ~~Header values returned to the browser?~~ **Answered: yes, to anonymous visitors**
   (backend-findings.md §2). Backend fix needed regardless of the SDK.
4. **Shadow-aware compliance probe** in the Portal shell (css-isolation.md §5). Must land before the
   hard-fail switch (PBI 433384).
5. **`publish` command** with admin token handling: ship or skip.
6. **Private widget file naming / fixed `1.0.0` version** (backend-findings.md §3): keep the CLI workaround
   only, or also harden the backend (normalise names on upload, derive storage paths from metadata).

## Portal-side work items to create

- PBI (security, high): redact `ServiceConnection.Security` header values from non-admin read models.
- PBI (feature): widget-facing service-connection proxy that injects stored headers server-side.
- PBI (robustness): private widget storage paths derived from metadata; validate tag/file names on upload.
- PBI: shadow-DOM-aware widget compliance probe.
- PBI: contract drift spec in SSP_Portal importing `@serviceware/portal-widget-sdk/contract` and asserting
  `Events` enum + `EventManager` suffix + element I/O names; plus `widget-package.service.spec.ts` case
  that unpacks a zip fixture produced by the CLI.
- Docs: link the SDK from `libs/utils/docs/index.md` for external (non-Angular) authors.

## Phases

### Phase 0 — repo bootstrap (this folder)
- [x] folder, `git init`, docs, schemas, reference snapshots, workspace skeleton
- [ ] `pnpm install`, tsup/vitest/eslint config, CI workflow running lint/test/build on PRs
- [ ] confirm scope name, rename packages if needed

### Phase 1 — sdk
- [x] `src/contract.ts` constants + `src/types.ts`
- [x] commands: toast, showConfiguration, navigate, skeleton, onWidgetResize (`src/events.ts`)
- [x] element outputs: saveConfiguration (with secret guard), cancelConfiguration (`src/outputs.ts`)
- [x] `createPortalFetch` with origin-safe prefix check (`src/fetch.ts`)
- [x] `definePortalWidget` (inputs batching, shadow/light style injection) (`src/element.ts`)
- [x] `defineConfigSchema`, `withDefaults`, `debugConfig` (`src/config.ts`)
- [x] tests per docs/sdk.md §7 (jsdom, 36 specs)
- [ ] size budget check in CI (ESM entry is ~12 kB unminified today; measure minified + gzip)
- [ ] verify against a live Portal (Phase 3 manual run)

### Phase 2 — cli
- [x] **Ported** from SSP_Portal `libs/create-widget` (see [cli-port-from-ssp-portal.md](cli-port-from-ssp-portal.md)):
      wizard (embed path, and a custom path that writes the config for bring-your-own bundles), `pack`,
      `validate`, `unpack`, 130 vitest specs. No private packages: the Angular/CB3 scaffold stayed in SSP_Portal.
      The items below are the framework-agnostic design this port does not yet cover.
- [ ] `init` (vanilla-ts template)
- [ ] `build` (esbuild, env allowlist, CSS pipeline, both bundles, define check)
- [ ] `validate` (schema, tag, semver, secret scan, CSS lint, translations, limits)
- [ ] `pack` (DTO mapping, allowlist, deterministic zip)
- [ ] `release` (port of prepare-widget-release)
- [ ] fixture-based tests

### Phase 3 — end to end
- [x] `examples/serviceware-logo-three` (three.js, vanilla TS): settings UI when `settingsMode`, toast
      buttons, open-settings button, navigate, skeleton, resize log, translation load, secret guard, light
      and shadow CSS builds, Portal-mock dev harness with a copy of the compliance probe
- [ ] manual run: build → pack → import in Portal admin on localhost:4200 → toast + config modal work,
      no `[Widget Compliance]` warning, Portal styles unchanged
- [ ] publish `0.1.0` of both packages (after scope confirmation)

### Phase 4 — Portal side
- [ ] contract drift spec PR in SSP_Portal
- [ ] compliance probe PR
- [ ] backend answers on proxy/redaction, then SDK `createServiceClient`

### Later
- Angular preset (port `webpack.externals.js`, `extra-webpack.config.js`, `elements-build-script.js`,
  `rename-widget.js`; long-term `@ssp/utils` could depend on the public CLI instead of duplicating).
- `publish` command. `npm create portal-widget` scaffolder. React/Lit templates. Playwright regression
  against a Portal docker image.

## Repo layout (target)

```
portal-widget-sdk/
  .github/workflows/ci.yml, release.yml
  .changeset/
  docs/                      contract, security, css-isolation, sdk, cli, plan, reference-sources
  schemas/                   widget-metadata.schema.json, widget-package-metadata.schema.json
  packages/sdk/              src/{index,contract,types,events,element,fetch,config}.ts, test/
  packages/cli/              src/{index,commands/*,css/*,secret-scan}.ts, templates/, test/fixtures/
  examples/vanilla-ts/
  reference/ssp-portal/      two Portal source snapshots read by the CLI drift spec (review before public)
```
