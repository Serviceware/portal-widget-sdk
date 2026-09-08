# `@serviceware/portal-widget-cli` — command specification

> **Status.** This document is the *target* design for a framework-agnostic CLI (`init`/`build`/`release`).
> What `packages/cli` actually contains today is the working CLI ported from SSP_Portal's
> `libs/create-widget` -- commands `portal-widget` (wizard), `new`, `pack`, `validate`, `unpack`, documented
> in `packages/cli/README.md`. The mapping and the open decisions are in
> [cli-port-from-ssp-portal.md](cli-port-from-ssp-portal.md).

Binary name: `portal-widget`. Node ≥ 20. Dependencies kept small: `esbuild`, `postcss`, `fflate`,
`semver`, `@clack/prompts` (or `prompts`), `commander` (or `cac`), `ajv` for schema validation.

All commands accept `--cwd <dir>` and look for `widget-metadata.json` there. All commands support
`--json` for machine-readable output and exit non-zero on failure.

---

## `portal-widget init`

Interactive scaffold in the current folder.

- Asks: tag name (validated as a custom-element name), display name (en), description (en), default size,
  authenticated, CSS mode, framework template (`vanilla-ts` in v1; `react`, `lit` later).
- Writes `widget-metadata.json` (schema `schemas/widget-metadata.schema.json`) with fresh UUIDs for `id`
  and `widgetVersion.id`, `angularVersion: 0`, `portalVersion: "v3"`, `state: "dev"`, version `0.1.0`.
- Writes `src/main.ts` using `definePortalWidget`, `src/styles.css`, `translations/en.json`,
  `package.json` scripts (`build`, `pack`, `validate`, `release`), `tsconfig.json`, `.gitignore`,
  `.env.example` with the `PORTAL_WIDGET_PUBLIC_` note.
- Flags for non-interactive use: `--tag`, `--name`, `--yes`.

## `portal-widget build`

- Bundles `src/main.ts` with esbuild: `format: 'iife'`, `target: 'es2020'`, single output file, minified,
  no source map unless `--sourcemap`.
- `define`: only `process.env.PORTAL_WIDGET_PUBLIC_*` and `import.meta.env.PORTAL_WIDGET_PUBLIC_*` are
  inlined; every other `process.env.X` becomes `undefined`. `.env`/`.env.local` files are read for the
  allowed prefix only.
- CSS: collects all CSS, runs the pipeline from `docs/css-isolation.md` §3 for the chosen mode, emits it
  as a string constant consumed by `definePortalWidget({ styles })` (via a virtual module
  `portal-widget:styles`).
- Emits `dist/<tag>-1.0.0-full.js` and `dist/<tag>-1.0.0-light.js`. The `1.0.0` is fixed for private
  widgets because the backend stores and resolves them under that version (see
  `docs/backend-findings.md` §3); the real semver from `widget-metadata.json` is embedded in the bundle
  as a banner comment and reported by `--json`. `--target registry` (later, for Portal-team widgets)
  switches to `<tag>-<version>-<kind>.js`.
  - Default: identical content.
  - `--light-externals rxjs` (Angular users later): externalise the listed globals per the Portal's global
    map in `docs/contract.md` §6.
- Verifies the output contains `customElements.define(` with the metadata tag; fails otherwise.
- `--watch` rebuilds on change and serves `dist/` on `--port 4201` with CORS, printing the Chrome
  DevTools override / `dev-widgets.json` instructions from `docs/contract.md` §10.

## `portal-widget validate`

Runs automatically inside `pack`; can be run alone.

1. `widget-metadata.json` against `schemas/widget-metadata.schema.json`.
2. Tag name is a valid custom-element name; equals `widgetVersion.name`; contains no digits and not the
   substrings `light` or `full` (storage path resolution, `docs/backend-findings.md` §3).
3. `widgetVersion.number` is semver; `package.json` version matches if present. Warns that the Portal will
   display private widgets as `1.0.0` regardless.
4. Both bundles exist with the fixed private file names and contain `customElements.define('<tag>'`.
5. Secret scan on both bundles (`docs/security.md` §4). `--allow-secret-pattern <regex>` repeatable.
6. CSS lint (`docs/css-isolation.md` §4).
7. Translation files in `translations/` are `<lang>.json`, where `<lang>` is a valid .NET `CultureInfo`
   name (bundled list, case-insensitive: `en`, `de`, `pt-BR`, `en-US`, …), valid and non-empty JSON; an
   `en.json` exists if any exist.
8. Limits from `docs/contract.md` §9: ≤ 10 tags, ≤ 10 dependencies, name ≤ 100, description ≤ 4000,
   `en` present in `meta` and `changes`.
9. Logo, if present, is a PNG.

## `portal-widget release` (alias `bump`)

Port of the Portal's `prepare-widget-release` tool (see `reference/ssp-portal/prepare-widget-release.ts`).

- Interactive: bump type (major/minor/patch/custom), technical changelog entries (Keep a Changelog
  categories) into `CHANGELOG.md`, customer-facing `changes` per language into the metadata (plain text
  auto-wrapped in `<p>`/`<ul><li>`), optional updates of `authenticated`, `defaultSize`, `dependencies`.
- Regenerates `widgetVersion.id`, sets `date` (`YYYY-MM-DD HH:mm`), `state: "released"`,
  `filename: "<tag>-<version>.tar.gz"`, bumps `package.json` version.
- Non-interactive flags: `--version`, `--date`, `--lang en,de`, `--authenticated`, `--size 2x1`,
  `--dep "Portal>=3.0.0"`, `--no-interactive`, `--dry-run`, `--force`.

## `portal-widget pack`

- Runs `validate`.
- Builds the import DTO from the metadata (mapping table in `docs/contract.md` §9) and writes it as
  `widget-metadata.json` inside the zip.
- Adds `dist/<tag>-1.0.0-full.js`, `dist/<tag>-1.0.0-light.js`, `logo.png` (from `logo.png` file
  or the base64 `logo` field), `translations/*.json` renamed to `<lang>.json` at zip root.
- Nothing else. Deterministic ordering and timestamps. Output `dist/<tag>-<version>.zip` (the zip name may
  carry the real semver; the bundle names inside may not).
- Prints the admin steps: Portal Admin → Widgets → Add private widget → Import zip.

## `portal-widget publish` (later, needs decision)

`POST {apiUrl}/api/v2/admin/widgets/private` with the multipart fields from `docs/contract.md` §9, using an
admin token from `PORTAL_ADMIN_TOKEN` env or an interactive device/browser login. Not in v1 unless the
Portal team agrees on token handling.

---

## Programmatic API

Every command is exported as a function (`build(options)`, `pack(options)`, …) from the package root so
other tools (and the tests) can call them without spawning a process.

## Tests

- Fixture widget under `packages/cli/test/fixtures/hello-widget`. `build` → `pack` → unzip with `fflate`
  → assert entries and the DTO against `schemas/widget-package-metadata.schema.json`.
- CSS pipeline snapshot tests for both modes, including keyframes/font-face namespacing and idempotency.
- Secret scan tests with positive and negative samples.
- `validate` fails when the bundle lacks `customElements.define`.
