# Private Widget Toolkit -- handover from SSP_Portal

> Written by the toolkit's author in `SSP_Portal` (branch `feature/private-widget-toolkit`) as
> `.claude/agents/private-widget-toolkit.md`; reproduced here unchanged because `.claude` is gitignored
> over there. **Paths below are SSP_Portal paths.** `libs/create-widget/` is now `packages/cli/` in this
> repository (see [cli-port-from-ssp-portal.md](cli-port-from-ssp-portal.md) for the file-by-file map);
> `widgets/embed-widget/` and the whole Angular/CB3 scaffold (`ssp-widget new`, `assets/scaffold/`) stay in
> SSP_Portal: this repository has no dependency on private packages or the internal feed. Renamed here: the binary is `portal-widget`, the config
> file `portal-widget.json`, the ZIP sidecar `portal-widget.json.txt`, the env var `PORTAL_WIDGET_CLI`.
> Everything about the ZIP format, the prelude, the CB3 regex trap and the Portal behaviours still
> applies verbatim.

# Private Widget Toolkit — working context

You are picking up work on the private widget toolkit. This is the handover: what exists,
why, what is already decided, and the traps that cost real time.

Read this before touching `libs/create-widget/` or `widgets/embed-widget/`.

---

## The problem it solves

The Portal has always accepted private widget uploads at
**Administration → Configuration → Widgets management**, behind the `private-widgets`
feature flag. The upload worked. The gap was that **nobody outside the frontend team could
produce something to upload** — no documentation existed and the ZIP format was undocumented.

A trap that caused real confusion: **two unrelated files are both called
`widget-metadata.json`.**

| File | Shape | Where |
|---|---|---|
| Build-side | `{id, name, meta[], widgetVersion{number, state, filename, changes[]}}` | `widgets/widget-metadata.schema.json` |
| ZIP-side | `{tagName, name[{language,value}], defaultSize, fileFullName, fileLightName}` | `WidgetMetadataImportDto` |

They share nothing but the filename. Never conflate them.

---

## Two paths — both deliberate, keep both

### Embed — no code

```
ssp-widget
? Name:  IT Status
? URL:   https://status.example.com
-> it-status.zip
```

Produces a widget **named "IT Status"** in the Portal's widget list, already pointed at
that URL. A PO can drop it on a page and it works.

One prebuilt bundle lives in `libs/create-widget/assets/embed/ng22/`. The packer copies it
byte-for-byte and **prepends a prelude** carrying the tag and config:

```js
globalThis.__SSP_WIDGET_DEF__={"tag":"it-status","template":"embed","config":{...}};
/* ...untouched prebuilt bundle follows... */
```

The bundle reads that global **synchronously at module top level**, before
`createApplication()`. Reading it inside a promise would let a second widget's prelude
clobber the first — both share one `globalThis`. This was verified live with several
widgets on one page.

**Why not just use `container-widget`?** Container renders a URL in an iframe too, and it
is already installed everywhere. But Container is *one generic tile* that each person
configures per placement. The embed path produces **named, pre-pointed catalogue entries**
— "IT Status" and "Team Docs" as separate widgets someone can simply pick. That is a
different product experience.

Container is still the better answer for a one-off URL on someone's own page. Do not remove
the embed path on the grounds that Container duplicates it — that was tried, and reverted.

### Custom — with code

```
ssp-widget new "Weather"
cd weather && pnpm install && pnpm run build && ssp-widget pack
```

Generates a standalone Angular Elements project with CB3 and CSS isolation pre-wired, both
build modes, and a working per-placement settings screen. The author edits one file. Its
tag is baked at **build** time, so there is no prelude — `pack` instead asserts the declared
`tagName` appears as a quoted literal in the built bundle before writing anything.

This path exists for what Container and embed cannot do: call an API and render the result.

---

## Decisions already made

**The CLI config travels inside the ZIP as `ssp-widget.json.txt`, not `.json`.** Load-bearing.
`WidgetPackageService.unpack()` treats *any* `.json` other than `widget-metadata.json` as a
language file, and `Intl.getCanonicalLocales('ssp-widget')` returns a **valid** tag (`ssp`
is a legal 3-letter primary subtag, `widget` a legal variant). A flat `ssp-widget.json` would
be accepted as a genuine translation for a bogus locale and uploaded with the widget.
`.json.txt` fails the suffix filter outright.

**Package name and registry are undecided.** The name lives in exactly one constant,
`src/lib/package-identity.ts`. Nothing is published; no release pipeline is wired. This repo
has none — `@ssp/utils` is published from `SSP_Pipeline_Templates`, a different repo.

---

## The two tests that must not be weakened

**`portal-contract.spec.ts`** imports the **real** `WidgetPackageService` from `libs/admin`
via `TestBed` and asserts a packed ZIP unpacks through it. This is the anti-drift guarantee:
the CLI's format cannot silently diverge from the Portal's reader. A spec that reimplements
`unpack()` proves only that our code agrees with itself.

Its jest config must mirror `libs/admin/jest.config.ts`, **not** `libs/ai`'s. `libs/ai` swaps
in a bare `ts-jest` transform; Angular is ESM-only, so under that transform the spec cannot
import the real service at all and would silently not run.

**`rules-drift.spec.ts`** reads the upload dialog's source off disk and fails if a mirrored
constant changes. Edit `MAX_TAGS` in the dialog and this suite breaks — by design.

---

## Traps that cost real time

### The CB3 detection is a source-text regex, and it is load-bearing

```js
/provideCodeBlue\s*\([\s\S]*?kind\s*:\s*['"]preset['"][\s\S]*?preset\s*:\s*['"]cb3['"]/m
```

It requires the literal `kind: 'preset'` **textually before** `preset: 'cb3'` inside a
`provideCodeBlue(` call. Extract that object to a variable, reorder the keys, or build it
programmatically and the regex stops matching → build-time scoping silently re-enables with
a hardcoded widget name → **CSS isolation breaks with no build error.**

In a scaffold that is not one broken widget, it is every widget anyone generates. The
generated project's `tools/rename-bundle.mjs` hard-fails its own build if `main.ts` stops
matching. Leave that check in place.

Related: `css-isolation-webpack-plugin.js:715` calls `getWidgetName()` and returns early with
a warning **before** the CB3 skip at :729 — so the `WIDGET_NAME` constant is load-bearing
even though CB3 never uses it for scoping. Do not prune it as unused.

### The published rename-widget.js cannot be used by a flat project

`isCodeBlue3Widget()` filters sources through `filterFilesNearName`, whose regex requires the
widget name as a **path segment**. In this monorepo `widgets/embed-widget/src/main.ts` has
it; a flat generated project (`src/main.ts`) does not, so CB3 is not detected and legacy
statically-scoped CSS plus a duplicate `@layer` order get injected into the light bundle —
silently. The scaffold ships its own `tools/rename-bundle.mjs`. For a CB3 widget the original
does nothing but rename `main.js`, so this is a faithful replacement.

### pnpm 10+ ignores .npmrc for the settings that matter

The published build script finds the project root by walking **five levels up** from its own
location. That only lands correctly when `@ssp/utils` sits **flat** in `node_modules`. Under
pnpm's default nested layout it lands inside `.pnpm/` and the build fails with
`ENOENT ... .pnpm\@ssp+utils@<hash>\widget-metadata.json`.

`nodeLinker` and `shamefullyHoist` moved out of `.npmrc` **and** out of the `pnpm` field in
`package.json`. They must be in **`pnpm-workspace.yaml`**:

```yaml
nodeLinker: hoisted
shamefullyHoist: true
allowBuilds:
  esbuild: true
  '@parcel/watcher': true
  lmdb: true
  msgpackr-extract: true
```

Install with **pnpm, not npm** — npm ignores these entirely and prints
`Unknown project config` while producing a layout the build cannot use.

**The scaffold does not ship this file yet. Highest-value outstanding fix.**

### BaseElementComponent needs its constructor argument

```ts
constructor() {
    super(widgetTranslations);   // required
    effect(() => { ... });
}
```

Delete that constructor and Angular cannot build a DI factory. The custom element still
registers, so the tag is defined — but the component never instantiates and the tile renders
**blank**, with `This constructor was not compatible with Dependency Injection` in the console
and no build error.

Use `effect()` on `configuration()` rather than `ngOnInit`, so the tile updates live when an
admin saves settings. `ngOnInit` reads config once and the view goes stale.

### Version numbers live in three files

`widget-metadata.json` (drives bundle filenames), `ssp-widget.json` (drives the ZIP), and
`package.json`. Bump one and not the others and you get bundles the ZIP does not reference.

---

## Portal behaviour that looks like a bug in your widget

| Symptom | Cause |
|---|---|
| Configuration page "will not open" | Expired session. Redirects to Keycloak silently. Log in again. |
| No "Add private widget" button | You deep-linked. `FeatureFlagsService` guards with `if (!this._featureFlags)` and `[]` is truthy, so an empty array caches for the page load. Go Home first, then Configure. |
| Import menu entry is a code word | `widgets_management_import_private_widget` has no translation. Harmless. |
| Upload greyed out, no reason | A language file over **1 MB** (picker advertises 5 MB; `PortalValidators.validateJSONFile` enforces 1) or a duplicate `tagName`. |
| Cannot re-import an existing widget | By design — Import creates a **new** widget and tags must be unique. Use **Edit**, or delete first. |
| Tile blank, tag defined | The bundle 404s from storage, or the component failed to construct. Check console and network. |
| Clicking the button opens a blank form | That is the button. The **small arrow** beside it is Import. |
| Widget settings nowhere to be found | Per-widget gear in the page-configuration panel's widget list — **not** on the tile. |

---

## Four pre-existing Portal defects found while building this

Not caused by this work. Each deserves its own ticket.

1. **`FeatureFlagsService` caching race** — `if (!this._featureFlags)` treats `[]` as loaded.
   Deep-linking to a flag-gated page silently disables the feature for that page load.
2. **1 MB vs 5 MB language files** — picker advertises 5 MB, enforcement is 1 MB. A 2 MB file
   passes the picker then silently disables Upload with no explanation.
3. **Shared `outputPath`** — `build:<widget>:full && build:<widget>:light` destroys the full
   bundle for **every** widget in this repo. Both write to `dist/widgets/<name>` and Angular
   wipes it between builds. Not hit today because pipelines build one mode at a time.
4. **Raw translation key** — `widgets_management_import_private_widget` renders unlocalised.

---

## How to verify a change end to end

1. `pnpm nx test create-widget` — 170 tests, must stay green. Never weaken an assertion to
   keep a count.
2. Embed path: `ssp-widget` in a temp dir, answer two questions, get a ZIP.
3. Custom path: `ssp-widget new "Test"` outside the repo, add `pnpm-workspace.yaml`,
   `pnpm install` (needs internal Azure feed credentials), `pnpm run build`. Expect both
   bundles, the `CSS isolation skipped for CB3 preset widget` line, and **no**
   widget-name-inference warning.
4. `ssp-widget pack`, then import through the Portal's real Import button. The feature flag
   must be enabled or the button does not render:
   `INSERT INTO labs_selfserviceportal.featureflags (id, website, name) VALUES ('<uuid>', 1, 'private-widgets')`
5. Place it, open its gear in the page-config panel, change a setting, confirm other
   placements are unaffected.

Automated tests cannot prove steps 3–5. They need a running Portal.

---

## Outstanding work

- **Ship `pnpm-workspace.yaml` in the scaffold.** Highest value; every generated project
  needs it added by hand and fails confusingly without it.
- One command to bump the version in all three files.
- A generated-project test asserting its component still calls `super(widgetTranslations)`.
- Document how to update a widget you already uploaded — Import refuses duplicate tags by
  design, so the path is Edit, or delete and re-import. Second thing anyone tries.
- Decide the package name and registry.

## Scope rules

Do not modify `libs/admin/**`, `libs/common/**`, `libs/utils/src/shared/widgets/**`, or
`container-widget` / `launcher-widget` / `free-content-widget`. Read them freely; changing
them is out of scope. Found a defect there? Record it rather than fixing it inline.
