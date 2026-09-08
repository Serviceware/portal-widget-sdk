# Getting started: your first private widget

This is the end-to-end walkthrough for widget authors: from an empty folder to a widget running in
Serviceware Portal, with any front-end framework or none. It links to the reference documents instead of
repeating them. The complete worked example is
[`examples/serviceware-logo-three`](../examples/serviceware-logo-three/).

---

## 1. What you need

- Node 20 or newer and a package manager (npm, pnpm or yarn).
- A Portal 3.x with the `private-widgets` feature flag enabled and an administrator account.
- The two packages from npm: `@serviceware/portal-widget-sdk` (runtime, a regular dependency of your widget)
  and `@serviceware/portal-widget-cli` (a dev dependency, or run ad hoc with `npx`). Inside this repository
  the example depends on them as `workspace:*` instead; run `pnpm install` and `pnpm build` at the root first.

## 2. How a widget works, in one paragraph

A widget is one classic JavaScript file that registers a custom element. The Portal loads the file, creates
the element in its grid, sets a fixed set of properties on it (configuration, auth token, API URL, language,
admin flags) and listens for two DOM events (`configurationSaved`, `configurationCanceled`). Everything else
(toasts, opening the settings dialog, navigation, skeleton) is a `CustomEvent` on `window`. There is no
iframe: your code runs in the Portal's page, so CSS isolation and secrets handling are your responsibility.
The exact rules are in [contract.md](contract.md); the SDK wraps all of them.

## 3. Create the project

```
my-widget/
  package.json
  portal-widget.json      the CLI's config (wizard-generated)
  tsconfig.json
  build.mjs               esbuild script (copy from the example)
  src/main.ts
  src/styles.css
  translations/en.json    optional
```

Run the CLI wizard and choose the **custom** path. It asks for a display name and writes
`portal-widget.json` with a derived tag and the paths where your bundles must land:

```bash
npx @serviceware/portal-widget-cli          # or `npx portal-widget` once it is a dev dependency
? Widget type: custom
? Display name: My Widget
-> portal-widget.json  (tagName ssp-my-widget, bundles/ssp-my-widget-1.0.0-{full,light}.js)
```

Edit the file afterwards as you like. Tag rules: a valid custom-element name (lowercase, contains a
hyphen), unique per tenant, **no digits** and not containing `light` or `full` (the storage service
resolves bundle files from the tag, [backend-findings.md](backend-findings.md) section 3). Keep
`angularVersion: 0` unless you build an Angular light bundle against the Portal's globals.

## 4. Write the widget

Minimal `src/main.ts`:

```ts
import { defineConfigSchema, definePortalWidget, withDefaults } from '@serviceware/portal-widget-sdk';
import styles from './styles.css'; // build.mjs inlines this as a string

interface Settings { greeting: string; apiKey: string }

const schema = defineConfigSchema<Settings>({
    greeting: { type: 'string', default: 'Hello' },
    apiKey: { type: 'string', secret: true, default: '' } // save() refuses a non-empty value
});

definePortalWidget<Settings>({
    tag: 'ssp-my-widget',
    cssMode: 'light',           // passes the Portal's compliance probe today; see section 6
    styles,
    configSchema: schema,
    render(ctx) {
        if (ctx.inputs.settingsMode) {
            // Only the administrator's settings dialog renders the element with settingsMode = true.
            ctx.root.innerHTML = `<form><input name="greeting"><button>Save</button></form>`;
            const form = ctx.root.querySelector('form')!;
            (form.elements.namedItem('greeting') as HTMLInputElement).value =
                withDefaults(ctx.inputs.configuration, schema).greeting;
            form.addEventListener('submit', event => {
                event.preventDefault();
                ctx.save({ greeting: (form.elements.namedItem('greeting') as HTMLInputElement).value, apiKey: '' });
            });
            return;
        }
        const { greeting } = withDefaults(ctx.inputs.configuration, schema);
        ctx.root.innerHTML = `<p class="greeting">${greeting}</p><button class="hi">Toast</button>`;
        ctx.root.querySelector('.hi')!.addEventListener('click', () => ctx.toast.success('Hi from my widget'));
        if (ctx.inputs.showSettingsButton) { /* render your own settings entry point calling ctx.openSettings() */ }
    },
    onInputsChange(changed, ctx) {
        if (changed.configuration) { /* the admin saved: re-read withDefaults(...) and update the DOM */ }
    }
});
```

What the context gives you (full list in [sdk.md](sdk.md) section 4):

| Need | Use |
|---|---|
| Where to render | `ctx.root` (shadow root or the element itself) |
| Current Portal inputs | `ctx.inputs` (live object; react to changes in `onInputsChange`) |
| Settings persisted | `ctx.save(customConfig)` / `ctx.cancel()` inside settings mode |
| Open the settings dialog | `ctx.openSettings()`; show the trigger only when `ctx.inputs.showSettingsButton` is true |
| Toasts | `ctx.toast.success / info / warning / error` |
| Portal API calls | `ctx.fetch(url)` adds the bearer token only for `apiUrl` requests |
| Translations you uploaded | `ctx.loadTranslations(lang)` |
| Grid resizes | `ctx.onResize(cb)`; also observe your own element with `ResizeObserver` |
| Navigation and skeleton | `navigate()`, `showSkeleton()`, `hideSkeleton()` from the package root |
| Logging without leaking | `debugConfig(ctx.inputs.configuration, schema)` |

Admin versus visitor: the Portal sets `showSettingsButton` only for administrators who are not in grid edit
mode, and renders the element with `settingsMode` only inside the administrator's settings dialog. Visitors
never see the settings UI. Do not add your own "am I an admin" logic beyond reading those inputs; the
backend enforces who may persist a configuration.

## 5. Build

Copy [`examples/serviceware-logo-three/build.mjs`](../examples/serviceware-logo-three/build.mjs). It runs
esbuild with `format: 'iife'`, `target: 'es2020'`, bundles everything into the two file names from
`portal-widget.json` (identical for non-Angular widgets), inlines `.css`/`.svg` imports as strings, scopes
the CSS for light mode, and checks that the tag appears as a string literal in the output (which `pack`
also verifies). `node build.mjs --watch --serve` adds a Portal-mock harness on `http://localhost:4201`.

Rules the build must respect ([security.md](security.md) section 4): no `.env` files bundled, no
secrets in the source, no source maps in what you upload, bundles under 10 MB.

## 6. CSS

Pick a mode ([css-isolation.md](css-isolation.md)):

- **light** (default in the example): styles go into the document, so every selector must be prefixed with
  `[<tag>]` and wrapped in `@layer widgets`. The example's `build.mjs` does this for a flat stylesheet.
  Passes the Portal's compliance probe today.
- **shadow**: styles live in the shadow root, nothing can leak either way, but the Portal's probe cannot
  see them yet and warns. Use it once the Portal-side change has shipped.

Runtime CSS-in-JS (emotion, styled-components, Vue `<style>` injection) is unsupported in light mode;
in shadow mode point the library at `ctx.root`.

## 7. Test without a Portal

The example's `dev/` folder is a stand-in for the Portal shell: it loads your bundle as a classic script,
sets all fourteen inputs, mocks toasts, the settings dialog, skeleton, resize events and the translations
endpoint (which rejects requests without a bearer token), and runs a copy of the CSS compliance probe.
Copy `dev/index.html` and `dev/harness.ts` next to your widget; they only depend on the SDK's contract
constants and the tag from `portal-widget.json`.

## 8. Test in a Portal, pack and import

```bash
node build.mjs
npx portal-widget validate portal-widget.json
npx portal-widget pack                             # -> <tagName>.zip
```

Import: Portal Administration, Configuration, Widgets tab (`admin/configuration?tab=4`), the **small arrow**
next to "Add private widget", Import, pick the zip, Upload. Navigate to Home first and then to
Configuration; deep-linking hides the button because of a feature-flag caching bug in the Portal.

Then place the widget on a page, open the browser console and confirm there is **no `[Widget Compliance]`
warning**. The per-widget settings gear is in the page configuration panel, not on the tile.

Updating: Import refuses a duplicate tag by design. Use **Edit** on the installed widget to upload new
bundles, or delete it and re-import. For fast iteration without re-importing, override the bundle
response in Chrome DevTools (Sources, Overrides) or use `dev-widgets.json` in a Portal checkout
([contract.md](contract.md) section 10).

## 9. Data and secrets, the short version

- `customConfig` and translation files are visible to **every** visitor of the page. Never store
  credentials there. The `secret: true` schema flag makes `save()` throw if you try.
- `authToken` is the current user's Portal session. `ctx.fetch` sends it to the Portal API only.
- `userProfile` is personal data for the current user; render it, never persist or forward it.
- **Service connections and API keys.** The Portal lets an administrator store third-party credentials
  in a Service Connection and link it to a widget; `configuration.serviceConnections` lists them.
  Today there is **no server-side proxy** that would inject those headers, and the Portal even returns the
  header values to anonymous visitors ([backend-findings.md](backend-findings.md) sections 1 and 2). Until
  the backend fixes land, a browser widget has no secure way to use a private API key. Options now:
  keys that are public by design and restricted by referrer (maps, analytics), or your own backend that
  holds the key and validates the Portal token. The SDK will add `createServiceClient` once the proxy exists.

## 10. Using a framework

The SDK has no framework dependency and no framework adapter; the contract is plain DOM. `ctx.root` is a
normal mount point, `ctx.inputs` is a plain object and `onInputsChange` is your change notification.

React:

```tsx
import { createRoot, Root } from 'react-dom/client';
definePortalWidget({
    tag, styles, cssMode: 'light',
    render(ctx) {
        const root: Root = createRoot(ctx.root as HTMLElement);
        const paint = () => root.render(<App inputs={{ ...ctx.inputs }} ctx={ctx} />);
        paint();
        (ctx as unknown as { repaint: () => void }).repaint = paint;
        return () => root.unmount();
    },
    onInputsChange(_changed, ctx) { (ctx as unknown as { repaint: () => void }).repaint(); }
});
```

Vue: `createApp(App, { ctx }).mount(ctx.root as HTMLElement)` in `render`, hold the app instance and call
`app.unmount()` in the cleanup; feed `onInputsChange` into a `reactive()` store.
Lit: `render(html\`...\`, ctx.root)` in both `render` and `onInputsChange`.
Svelte: `mount(App, { target: ctx.root, props })` and `unmount` in the cleanup.
Angular: possible as Angular Elements with `angularVersion: 0` and a full bundle, but the Portal's
CodeBlue components are not publicly available, so bring your own component library.

Things every framework must respect:

1. One classic IIFE script that calls `customElements.define` for the tag in `portal-widget.json`.
2. Scoped, layered CSS (light) or styles inside `ctx.root` (shadow). Runtime style injection into
   `document.head` breaks light mode.
3. Re-render on `onInputsChange`; `ctx.inputs` is not reactive by itself.
4. Do not touch `document.body` for portals/overlays in light mode unless the overlay element also carries
   the `[<tag>]` attribute.

## 11. Checklist before you import

- [ ] `validate` passes; `pack` wrote `<tagName>.zip`.
- [ ] Tag has no digits and not `light`/`full`; matches what the bundle registers.
- [ ] No secret in the bundle, in `customConfig` or in translation files.
- [ ] Light mode: every rule inside `@layer widgets` and prefixed with `[<tag>]`.
- [ ] Settings UI only reacts to `settingsMode`; settings trigger only when `showSettingsButton`.
- [ ] Harness: toasts, save/cancel round-trip, language switch and resize work; probe passes.
