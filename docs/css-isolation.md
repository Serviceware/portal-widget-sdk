# CSS isolation for SDK widgets

Goal: a widget's CSS must never change the Portal's look, and the Portal's CSS should change the widget as
little as possible. This document explains the mechanics and what the CLI enforces.

---

## 1. Why this is not automatic

- All widgets and the shell share one document. There is no iframe.
- **CSS Cascade Level 5: unlayered author CSS beats every layered rule.** The Portal puts all of its own
  CSS in named layers. A widget that ships a plain `button { … }` or `body { … }` therefore outranks the
  entire Portal.
- Some names are global regardless of layers or scoping: `@keyframes`, `@font-face` family names,
  `@property`, `@counter-style`.
- The Portal's compliance probe expects to find a rule with `[<tag>]` inside `@layer widgets` in
  `document.styleSheets`. Missing → warning today, widget refuses to load after Portal 3.0 GA (Portal PBI
  433384).

Portal layer order:

```css
@layer codeblue-legacy, codeblue3, portal-base, primeng, portal-overrides, widgets, app-overrides;
```

`widgets` is below `app-overrides` on purpose: an admin can still override a widget deliberately.

---

## 2. Two isolation modes

The SDK's `definePortalWidget()` and the CLI's `build` support two modes. The developer picks one in
`widget-metadata.json` → `sdk.cssMode` (CLI-only extension field, stripped before packing) or via the
`--css-mode` flag.

| | `shadow` (default) | `light` |
|---|---|---|
| Widget CSS leaking **out** | Impossible. Styles live in the shadow root. | Prevented at build time: every selector prefixed with `[<tag>]`, everything wrapped in `@layer widgets`. |
| Portal CSS leaking **in** | Only inherited properties (font, color, custom properties `--*`). | Portal `portal-base` element rules (`a`, `button`, `h1`…) reach in. Optional reset available. |
| Overlays appended to `<body>` (menus, tooltips, dialogs from libraries) | Lose widget styles. Render overlays inside the shadow root, or accept it. | Lose widget styles unless the overlay element also carries `[<tag>]`. |
| Runtime CSS-in-JS (emotion, styled-components, Vue runtime `<style>`) | Fine, if the library is told to inject into the shadow root. | Unsupported. Injected `<style>` tags are unlayered and unscoped. `validate` warns when it recognises such libraries. |
| Compliance probe | **Fails today** (`missing_css_scope_attribute`): the probe walks only `document.styleSheets`. Needs the Portal change in §5. | Passes. |
| `@font-face` | Must be in the document, not the shadow root. The CLI hoists `@font-face` to a document-level `<style>` and namespaces the family name (`<tag>__Family`). | Same hoisting. |

Recommendation: `shadow` for new non-Angular widgets once the probe change has shipped; `light` until then
and for widgets that rely on body-portaled overlays.

---

## 3. What the CLI does to CSS (both modes)

To be ported from the Portal's `libs/utils/src/shared/postcss-widget-scope-plugin.js` (SSP_Portal, branch
`portal30`), dependency footprint: `postcss` only. Until then the example's `build.mjs` implements the
light-mode subset for a flat stylesheet.

1. **Collect** all CSS produced by the bundler (imports of `.css`, framework-extracted styles, `styles.css`
   entry) into one stylesheet.
2. **Hoist globals** to the top, outside any layer: `@charset`, `@import`, `@namespace`, `@font-face`,
   `@keyframes` (all vendor forms), `@property`, `@counter-style`, `@font-feature-values`,
   `@font-palette-values`, `@color-profile`.
3. **Namespace global names**: `@keyframes fade` → `@keyframes <tag>-fade` and rewrite every
   `animation`/`animation-name` reference; `@font-face { font-family: X }` → `<tag>__X` and rewrite every
   `font-family` reference.
4. **Light mode only — scope selectors**: `.foo` → `[<tag>] .foo`; `:root`, `:host`, `html`, `body` →
   `[<tag>]`; `body::before` → `[<tag>]::before`. Non-custom-property declarations on root selectors are
   dropped (a widget must not restyle the document root). Sibling selectors off the host (`:host + x`) are
   dropped with a warning. The rewrite is idempotent.
5. **Light mode only — wrap** everything that is not a hoisted global in `@layer widgets { … }`. Author
   `@layer` blocks inside become sub-layers (`widgets.base`).
6. **Emit** the CSS as a JS string inside the bundle. At runtime the SDK injects it:
   - `shadow`: `<style>` (or `adoptedStyleSheets`) inside the shadow root, plus the hoisted globals in a
     document-level `<style data-portal-widget="<tag>">`.
   - `light`: one document-level `<style data-portal-widget="<tag>">` containing globals + the layered
     block. Marker comment `/* portal-widget-css-isolation */` kept for tooling.
7. **Minimal probe rule** in light mode: the CLI guarantees at least one rule `@layer widgets { [<tag>] {} }`
   exists so a CSS-less widget still passes the probe.

---

## 4. `validate` CSS lint (fails `pack`)

| Rule | Mode | Severity |
|---|---|---|
| Any style rule outside `@layer widgets` that is not a hoisted global | light | error |
| Any selector not starting with `[<tag>]` after processing | light | error |
| `@keyframes` / `@font-face` name without the `<tag>` namespace | both | error |
| `!important` on a bare element selector (`button`, `a`, `body`) | light | warning |
| Declarations on `:root`/`html`/`body` other than custom properties | both | warning (they are dropped) |
| Bundle references a known runtime CSS-in-JS library | light | warning |
| Portal token redefinition (`--p-*`, `--cb3-*`) at widget root | both | warning (allowed, but flagged: it changes Portal components rendered inside the widget) |

---

## 5. Portal-side change required for shadow mode

`libs/common/src/lib/page/containers/widget/utils/widget-compliance.ts` walks `document.styleSheets`
only. Proposed change: treat a widget as compliant when the custom element has an open `shadowRoot`
**and** no unlayered rule in `document.styleSheets` mentions `[<tag>]` outside `@layer widgets`
(i.e. the widget did not also leak into the document). Optional stricter form: require a
`[<tag>]`-anchored rule in `@layer widgets` in the document (the CLI's hoisted-globals `<style>` can carry
it).

This must land **before** the compliance warnings become hard failures, or every shadow-mode SDK widget
stops loading at Portal 3.0 GA.

---

## 6. Optional in-leak reset (light mode)

For widgets that want a clean slate without shadow DOM the CLI offers `--css-reset`, which prepends:

```css
@layer widgets {
  [<tag>] { all: initial; display: block; font: inherit; color: inherit; }
}
```

Aggressive: it also resets inherited Portal typography, hence the `font`/`color` re-inherit. Off by default.

---

## 7. Regression test (examples/vanilla-ts, later CI)

Mount the example widget inside a running Portal (localhost:4200) with Playwright and assert:

1. No console message containing `[Widget Compliance]`.
2. Computed styles of a fixed set of Portal elements (top bar background, primary button colour, body font)
   are identical with and without the widget on the page.
3. In light mode, `document.styleSheets` contains no rule mentioning `[<tag>]` outside `@layer widgets`.

Manual for v1; automated once a Portal docker image is available to the SDK pipeline.
