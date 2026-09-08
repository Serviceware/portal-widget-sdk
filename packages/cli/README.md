# @serviceware/portal-widget-cli

`portal-widget`: turns a hand-written or wizard-generated `portal-widget.json` into a Portal-importable
private widget ZIP, and recovers the config back out of any ZIP, including one the Portal itself exported.
One command, one ZIP. Runtime dependency: `fflate`. Nothing from the Portal monorepo, no private packages,
no internal feed.

```bash
npx @serviceware/portal-widget-cli            # run the wizard without installing
npm install --save-dev @serviceware/portal-widget-cli   # or add it to a widget project: npx portal-widget ...
```

Node 20 or newer. The package name, the bin name, the config file name and the ZIP sidecar name are held in
exactly one module: `src/lib/package-identity.ts`.

Ported from the SSP_Portal monorepo (`libs/create-widget`, branch `feature/private-widget-toolkit`). The
file-by-file map, what stayed behind and the open decisions are in
[`docs/cli-port-from-ssp-portal.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/cli-port-from-ssp-portal.md);
the original author's handover with every trap is
[`docs/handover-private-widget-toolkit.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/handover-private-widget-toolkit.md).

## Commands

| Invocation | What it does |
|---|---|
| `portal-widget` (no args) | Wizard: "embed" asks two questions and produces one import-ready ZIP; "custom" asks one question and writes a config that names where your own bundles must land |
| `portal-widget pack [--config <path>] [--out <dir>]` | Config to `<tagName>.zip`; refuses to write anything `validate` would reject |
| `portal-widget validate <portal-widget.json \| *.zip>` | Per-field pass/fail report, exit 1 on any error |
| `portal-widget unpack <zip> [--out <dir>] [--force] [--with-bundles]` | ZIP to editable `portal-widget.json`, recovered even from a foreign (Portal-exported) archive |
| `portal-widget --help` | Usage |

Every command that completes successfully ends by printing a next action, including where to click in
the Portal. `src/lib/output.ts`'s `nextAction` is the one place every closing message is written, and
`src/lib/cli-output.spec.ts` iterates every message kind so a command added without one fails the build.

`pack`, a clean `validate` on a ZIP, and the wizard's embed path all close by naming
`admin/configuration?tab=4`, the Portal's split-button Import entry that reads the produced ZIP.

## Running it from a repository checkout

```bash
pnpm install          # at the repository root
pnpm build            # builds packages/cli -> dist/bin.js, dist/index.js
node packages/cli/dist/bin.js --help
```

Rebuild after every change: `dist/` is what runs, not `src/`. Inside the workspace, `examples/*` reach the
CLI as `portal-widget` through their `workspace:*` dev dependency.

## Two paths

### Embed: no code

```
portal-widget
? Widget type:  embed
? Name:         IT Status
? URL:          https://status.example.com
-> ssp-it-status.zip
```

Produces a widget **named "IT Status"** in the Portal's widget list, already pointed at that URL. A
product owner can drop it on a page and change the URL later from the Portal's own settings panel.

The Portal's Container widget also renders a URL in an iframe. The difference: Container is one generic
tile that each person configures per placement; the embed path produces **named, pre-pointed catalogue
entries** someone can simply pick. Do not remove the embed path on the grounds that Container duplicates
it; that was tried and reverted.

### Custom: your own bundles, any framework

```
portal-widget
? Widget type:  custom
? Name:         Weather
-> portal-widget.json  (template "custom", bundles expected at bundles/ssp-weather-1.0.0-{full,light}.js)
```

The wizard stops at the config. You build the two bundle files with whatever toolchain you like, then run
`portal-widget pack`. What a bundle must do is the Portal contract in
[`docs/contract.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/contract.md) and the
runtime helpers in [`docs/sdk.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/sdk.md):
a single classic script that calls `customElements.define('<tagName>', ...)` for the tag in the config,
reads the properties the Portal sets on the element, and honours the CSS-isolation rules. Both `full` and
`light` are required by the upload form; for a non-Angular widget they are the same file and the Portal
always loads `full` (`angularVersion: 0`, which the wizard writes).

`pack` refuses to write a ZIP unless the declared `tagName` appears as a quoted string literal inside the
built full bundle, the one piece of evidence left that a build-time-tagged bundle registers the tag the
metadata claims. `validate` reports the absence of an embed prelude as a WARNING for a custom widget, not
an error.

The Angular/CodeBlue 3 project scaffold that used to back this path (`ssp-widget new`) depends on
Serviceware-internal packages and lives in the SSP_Portal monorepo, not here.

## `portal-widget.json`

The config file is the source of truth: the wizard writes it, `pack` reads it, `unpack` recovers it.
Full shape in `src/lib/config.ts`'s `SspWidgetConfig`:

| Field | Asked or derived? | Notes |
|---|---|---|
| `tagName` | Derived from the display name via `slugifyTag` (`src/lib/slugify.ts`) | Always `ssp-`-prefixed; guarantees `isValidCustomElementName` |
| `template` | Derived | `'embed'` or `'custom'`; `'unknown'` only when `unpack` cannot determine it |
| `version` | Derived | Defaults to `1.0.0` (`DEFAULT_WIDGET_VERSION`) |
| `name` / `description` | **Asked** (name) / derived | `description` repeats the display name; editable afterward in the config or the Portal dialog |
| `changes` | Derived | Always `"Initial version"` on first write |
| `tags` / `dependencies` | Derived | Empty arrays |
| `defaultSize` | Derived | `{ columns: 4, rows: 3 }` |
| `angularVersion` | Derived | `22` for embed (matches the checked-in bundles); `0` for custom (non-Angular, full bundle always used) |
| `authenticated` | Derived | `false` |
| `embed.defaultUrl` | **Asked** (URL) | Only when `template` is `'embed'` |
| `custom.fullBundlePath` / `custom.lightBundlePath` | Derived | Only when `template` is `'custom'`; relative to the config file's directory, never to the process cwd |
| `logo` / `languageFiles` | Not offered by the wizard | Hand-edit the config afterward; `pack` and `validate` both support them |

All defaults flow through `applyConfigDefaults` (`src/lib/config.ts`), the same function `readConfig`
uses, so a wizard-written config and a hand-written one can never disagree about what a default is.

## `validate`

`validate` mirrors the upload dialog's ENFORCED rules exactly. Every constant is copied from the code path
that actually gates the Upload button, never from a UI label. `src/lib/rules-drift.spec.ts` re-reads the
Portal sources (snapshotted under `reference/ssp-portal/`) on every run and fails if a mirrored constant no
longer appears there. Where the dialog disagrees with itself, the enforced value wins.

| Field | Rule | Portal source |
|---|---|---|
| `tagName` | required, <=100 chars, `^[a-z0-9-]+$` | `widget-management-add-private-widget-dialog.component.ts` `getTagNameError` |
| `tagName` (custom element) | lowercase start, >=1 hyphen, no trailing hyphen, not a reserved SVG/MathML name | **not enforced by the Portal**; added here |
| `name` / `description` / `changes` | English entry required, <=100 / 4000 / 4000 chars | `buildValidationState`, `getMultilanguageError` |
| `tags` | <=10 entries, each `^[a-zA-Z0-9-]+$` <=100 chars | `getTagsError`, `PortalValidators.isValidTag` |
| `dependencies` | <=10 entries, name and dependency both non-blank | `getDependenciesError` |
| `defaultSize.columns` / `.rows` | integer 1-12 | `buildValidationState` |
| `angularVersion` | integer 0-99 | `buildValidationState` |
| `logo` | <=2 MB | `PortalValidators.validateImageFile` |
| bundle files | <=10 MB | `PortalValidators.validateJSFile` |
| language files | <=**1 MB**, valid JSON, non-empty, filename resolves to a real language tag | `PortalValidators.validateJSONFile`, dialog's `isValidLanguageTag`/`extractLanguageCode` |
| `tagName` vs. bundle prelude | must match the tag baked into both bundles' own prelude | **not checked by the Portal at all**; added here |

### The 1 MB vs. 5 MB language-file limit

The dialog's file picker advertises **5 MB**, but the rule that gates the Upload button
(`PortalValidators.validateJSONFile` -> `validateFile(file, 'application/json', 1, false)`) enforces
**1 MB**. A file between the two passes the picker silently and then disables Upload with nothing shown.
`validate` enforces the real 1 MB limit and says so.

### The tagName / bundle-prelude coupling

The Portal never checks that a ZIP's `widget-metadata.json` `tagName` matches the tag the bundle
registers at runtime. A mismatch imports cleanly, uploads, and renders an empty tile with no console
error. `validate` extracts the tag from both bundles' prelude and compares each against the metadata;
`pack` runs the identical check on its own freshly-built ZIP before writing it. A bundle with no prelude
tag is a warning (it may register its element at build time) unless the sidecar declares the `embed`
template, in which case it is an error.

### What `validate` deliberately does NOT check

The dialog's `duplicateTagName` check needs the list of widgets installed on a specific, live Portal.
There is no way to check it offline. Import creates a **new** widget and tags must be unique: to update an
uploaded widget use **Edit** in the Portal, or delete it and re-import.

## The ZIP archive layout

`pack` produces a flat archive (`zipSync(entries, { level: 0 })`, matching `WidgetPackageService`'s own
call), in this entry order:

| Entry | Read by the Portal? |
|---|---|
| `widget-metadata.json` | yes, required, `WidgetMetadataImportDto` shaped |
| `<tagName>-<version>-full.js` | yes, via `fileFullName` |
| `<tagName>-<version>-light.js` | yes, via `fileLightName` |
| `logo.png` (optional) | yes, hardcoded name |
| `<language-tag>.json` (optional, repeatable) | yes, any other `.json` is a language file |
| `portal-widget.json.txt` | **no**, ignored entirely, see below |

Both bundles are always emitted; the upload form requires both.

Two unrelated files are both called `widget-metadata.json`. The build-side one
(`{id, name, meta[], widgetVersion{...}}`, schema in `schemas/widget-metadata.schema.json`) and the
ZIP-side one above share nothing but the filename. Never conflate them.

### Why the config sidecar is named `portal-widget.json.txt`, not `portal-widget.json`

`WidgetPackageService.unpack()` classifies every archive entry ending in `.json`, case-insensitively, as a
language file, except the exact name `widget-metadata.json`. A sidecar named `portal-widget.json` would not
merely be listed as a stray file: its stem passes `Intl.getCanonicalLocales` (`portal` is a syntactically
valid 6-letter language subtag, `widget` a valid variant), so it would travel with the widget as a bogus
translation file. (The dialog's own `/^[A-Za-z]{2,3}$/` primary-subtag check happens to reject `portal`, but
the archive reader runs first and does not apply it.) `.json.txt` fails the `.json` suffix test outright.
Stripping `.txt` yields the on-disk filename, which is what `unpack` uses to recover the config.

## `unpack`: recovering a config from any ZIP

`unpack <zip>` writes `portal-widget.json`, and where present `logo.png` and any language files, into the
output directory (the ZIP's own directory by default), then prints the same `validate` report.

- **A ZIP this tool produced** (sidecar present): the recovered config is byte-identical to the one that
  produced the ZIP.
- **A ZIP the Portal exported, no sidecar, prelude present**: `template` is synthesized as `'embed'`, all
  metadata fields come from `widget-metadata.json`, `version` is parsed from `fileFullName` (falling back
  to `1.0.0`), and `embed.defaultUrl` comes from the prelude payload.
- **Neither sidecar nor prelude**: `template` is `'unknown'` with a warning explaining what could not be
  recovered.

`unpack` is the one command that writes attacker-influenced bytes to a real filesystem path. Every entry
name is screened before anything is decoded or written: a path separator, a parent-directory segment or a
drive prefix is rejected, and every write target is re-checked to remain inside the output directory. A
64 MB cap applies to both the input file and the total decompressed size. An existing file is never
silently overwritten (`--force` is required). Bundles are only written with `--with-bundles`.

## Embed bundle assets (`assets/embed/ng22/`)

The two checked-in files are the pristine, prelude-free full and light bundles of the Portal's embed
widget, built in SSP_Portal (`widgets/embed-widget`). They are shipped artifacts the Portal serves as-is,
not a package dependency: `pack` never invokes a compiler; it reads these assets and prepends a small
prelude ahead of the untouched bytes:

```js
globalThis.__SSP_WIDGET_DEF__={"tag":"ssp-it-status","template":"embed","config":{"defaultUrl":"..."}};
/* ...untouched prebuilt bundle follows... */
```

The bundle reads that global synchronously at module top level, before it bootstraps, and deletes it, so
several embed widgets on one page cannot clobber each other's definition. Verified live.

The `ng22` directory name is deliberate: the light bundle binds to Portal-supplied Angular globals (the
Portal contract, `docs/contract.md`), so these assets are versioned per Portal Angular major and refreshed
whenever it changes.

### Refreshing them: `pnpm refresh-embed-assets`

`tools/refresh-embed-assets.mjs` builds `widgets/embed-widget` in a local SSP_Portal checkout
(`SSP_PORTAL_DIR` or `--portal <dir>`) and copies the pristine bundles into `assets/embed/ng<major>/`
(major defaults to 22). It copies the full bundle out before starting the light build, because both
Portal build configurations write to the same `dist/widgets/embed-widget/` and Angular wipes it between
builds. Manual only, never part of `build` or CI: regenerating a ~1.8 MB checked-in artifact is a
reviewable-diff act. This is the only place this repository touches the Portal monorepo, and only as a
maintainer with a checkout, never at install or run time.

## Tests

`pnpm test` runs the vitest suite, all offline. One drift guard must not be weakened:
**`rules-drift.spec.ts`** reads the Portal dialog and validator snapshots in `reference/ssp-portal/` and
fails if a mirrored constant changed. Refresh a snapshot with a changed limit and this breaks by design
until `rules.ts` follows.

The monorepo's `portal-contract.spec.ts` unpacked our ZIP through the Portal's real `WidgetPackageService`
via Angular `TestBed`. It cannot run here and was not reimplemented (a reimplementation proves only that
our code agrees with itself). It belongs in SSP_Portal; see `docs/plan.md`, Phase 4.

## Shipped runtime dependencies

`fflate` only. The CLI surface uses Node built-ins (`node:util` `parseArgs`, `node:readline/promises`,
`node:fs`, `node:path`). No Angular, no RxJS, nothing from the Portal or any private registry reaches the
shipped runtime, the build, or the tests.

## License

MIT. Source, issues and the full documentation:
[github.com/Serviceware/portal-widget-sdk](https://github.com/Serviceware/portal-widget-sdk).
