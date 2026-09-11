# astro-static-card

A Portal private widget whose content is **rendered by [Astro](https://astro.build) at build time**. The
bundle carries no framework runtime at all: Astro produces plain HTML and CSS, `build.mjs` folds them into
the widget bundle, and a 60-line runtime on `@serviceware/portal-widget-sdk` mounts the right language
variant and forwards a few clicks to the Portal. It is the opposite end of the spectrum from the React
example: static content, zero client-side framework.

## How it fits together

```
src/pages/[lang]/index.astro      the widget face      ─┐  astro build   dist-astro/<lang>/index.html
src/pages/[lang]/settings.astro   the settings dialog  ─┘  ───────────►  dist-astro/<lang>/settings/index.html
src/data/content.json             texts and links per language                    │
                                                                                   │ build.mjs lifts <body> + <style>
src/widget/main.ts   definePortalWidget: root.innerHTML = page[language]  ◄────────┘  (virtual:astro-pages, virtual:astro-styles)
                                                                          esbuild ► bundles/astro-static-card-1.0.0-{full,light}.js
```

| SDK concern | Where it is handled |
|---|---|
| Rendering | `render(ctx)` sets `ctx.root.innerHTML` to the pre-rendered `<body>` for `ctx.inputs.language` (exact code, then primary subtag, then `en`). |
| Input changes | `onInputsChange`: `language` or `settingsMode` repaints, `showSettingsButton` toggles the static button's `hidden` attribute. |
| Settings dialog | `settings.astro` is a static "nothing to configure" notice; its Close button calls `ctx.cancel()`. |
| Navigation | Links with `data-route` are intercepted and go through `navigate(route, query)`; other links open normally. |
| CSS isolation | Astro's scoped `<style>` blocks (attribute strategy, flat rules) are inlined by `build.inlineStylesheets: 'always'`, deduplicated, and in light mode prefixed with `[astro-static-card]` inside `@layer widgets`. |
| Guard rails | `build.mjs` refuses output the widget could not carry: external stylesheets, `<script>` tags, at-rules the flat scoper cannot handle. |

The footer shows the Astro version (read from the installed package by `build.mjs`) and the UTC build
time, so it is visible that the content is frozen at build time.

## Run it

```bash
pnpm install          # repository root
pnpm build            # builds packages/sdk and packages/cli (the example needs both dists)
cd examples/astro-static-card
pnpm install          # this folder is its own pnpm project, linked to ../../packages/*; pulls in Astro
pnpm dev              # astro build + esbuild on every change, serves http://localhost:4203
```

The harness in `dev/` is the same Portal mock as in the other examples. Switch the language to `de-DE`
to see the pre-rendered German page, tick **edition mode** to hide the settings button, open the
settings dialog and close it, click **Portal home** to see the navigation event.

## Build and pack for a Portal

```bash
pnpm build            # tsc --noEmit (runtime + harness), astro build, esbuild
pnpm validate         # portal-widget validate portal-widget.json
pnpm pack:widget      # -> astro-static-card.zip
```

## Notes

- Astro is a **dev dependency only**. Its output is HTML text inside the bundle; the whole widget is a
  few kilobytes plus the SDK.
- Because the content is static, changing a link means editing `src/data/content.json`, rebuilding and
  uploading new bundles through **Edit** on the installed widget.
- Keep `<style>` blocks flat (no `@media`, no `@keyframes`): the light-mode scoper in `build.mjs` handles
  the same subset as the other examples. `pnpm build:shadow` skips the scoping and puts the styles into a
  shadow root instead.
- Client-side `<script>` in Astro pages is rejected on purpose. Put behaviour into `src/widget/main.ts`,
  where the SDK context is available.
