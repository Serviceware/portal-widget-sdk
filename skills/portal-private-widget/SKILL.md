---
name: portal-private-widget
description: Build, test and package a private widget for Serviceware Portal 3.x with @serviceware/portal-widget-sdk and @serviceware/portal-widget-cli. Use when asked to create, scaffold, port, fix, build, pack or import a Portal widget, custom element or "private widget", produce the Portal import ZIP, or embed a URL as a Portal widget tile. Covers vanilla TS, React, Vue, Lit, Svelte and pre-rendered (Astro) widgets.
---

# Serviceware Portal private widget

A private widget is **one classic JavaScript file that calls `customElements.define('<tag>', …)`**. The
Portal loads it into its own page (no iframe), creates `<tag>` in its grid, sets properties on it and talks
to it through DOM events. `@serviceware/portal-widget-sdk` (browser, zero deps) wraps that contract.
`@serviceware/portal-widget-cli` (bin `portal-widget`, Node ≥ 20) turns `portal-widget.json` plus the two
bundle files into the ZIP an administrator imports. If anything here disagrees with
[`docs/contract.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/contract.md), the
contract wins.

## 1. Choose the path

- **Embed** (no code): a named tile that shows an existing web page in an iframe. Go to section 9.
- **Custom**: anything with its own UI, settings or Portal API calls. Sections 2-8.

Ask only if it is genuinely unclear. Default to custom with vanilla TypeScript, or the framework the user named.

## 2. Get the packages

Run `npm view @serviceware/portal-widget-sdk version`.

- **Published**: use the `package.json` below as is, run `npm install`, then pin the installed versions.
- **404 (not published)**: you need a built checkout of `github.com/Serviceware/portal-widget-sdk`. If one
  already exists with `packages/sdk/dist` and `packages/cli/dist`, use it as is. Otherwise clone it and run
  `pnpm install && pnpm build` at its root. Then replace `latest` with `file:<repo>/packages/sdk` and
  `file:<repo>/packages/cli` (forward slashes work on Windows too).

Never use `@ssp/*`, `@codeblue/*` or `@sw/*` packages: they are private and unavailable.

## 3. Create the project

```
my-widget/
  package.json
  portal-widget.json      CLI config: tag, names, bundle paths (source of truth)
  tsconfig.json
  build.mjs               esbuild -> bundles/<tag>-1.0.0-{full,light}.js
  src/main.ts             the widget (main.tsx for React)
  src/styles.css          flat CSS, scoped by build.mjs
  src/env.d.ts
```

Write every JSON file as UTF-8 **without BOM** (Windows PowerShell 5.1 `Set-Content`/`Out-File` add one,
and the CLI then rejects the file as malformed). `.gitignore`: `node_modules/`, `bundles/`, `*.zip`, `.env*`.

`package.json`:

```json
{
  "name": "my-widget",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit && node build.mjs",
    "validate": "portal-widget validate portal-widget.json",
    "pack:widget": "portal-widget pack"
  },
  "dependencies": { "@serviceware/portal-widget-sdk": "latest" },
  "devDependencies": { "@serviceware/portal-widget-cli": "latest", "esbuild": "^0.28.2", "typescript": "^5.6.0" }
}
```

`portal-widget.json` (replace every `my-widget` / `My Widget`):

```json
{
    "template": "custom",
    "tagName": "my-widget",
    "version": "1.0.0",
    "name": [{ "language": "en", "value": "My Widget" }],
    "description": [{ "language": "en", "value": "<p>What this widget shows.</p>" }],
    "changes": [{ "language": "en", "value": "<p>Initial version.</p>" }],
    "tags": ["Portal"],
    "defaultSize": { "columns": 4, "rows": 3 },
    "angularVersion": 0,
    "authenticated": false,
    "dependencies": [{ "name": "Portal", "dependency": ">=3.0.0" }],
    "custom": {
        "fullBundlePath": "bundles/my-widget-1.0.0-full.js",
        "lightBundlePath": "bundles/my-widget-1.0.0-light.js"
    }
}
```

Rules. The first four are **not** caught by `validate`, but break the widget in the Portal:

- **`tagName`**: lowercase letters and hyphens, at least one hyphen, no trailing hyphen, ≤ 100 chars,
  **no digits**, and **must not contain `light` or `full`** anywhere. Unique per tenant; a vendor prefix
  helps (`acme-ticket-stats`).
- **`version` must stay `"1.0.0"`.** The backend stores every private widget as 1.0.0 and only serves
  `<tag>-1.0.0-*.js`; `pack` names the ZIP entries from this field, so any other value imports and then 404s.
- **Bundle paths** must be `bundles/<tag>-1.0.0-full.js` / `-light.js`.
- **`angularVersion: 0`**, written explicitly. The CLI default is 22, which makes the Portal load the light
  bundle against its Angular globals.
- `name`, `description`, `changes` need an `en` entry; name ≤ 100 chars, the others ≤ 4000 (HTML allowed).
- `tags` ≤ 10, each `^[a-zA-Z0-9-]+$`; `dependencies` ≤ 10; `defaultSize` integers 1-12.
- `authenticated: true` hides the widget from anonymous visitors.
- Optional `"languageFiles": ["translations/en.json"]`: culture-named files (`en`, `de-DE`), valid non-empty
  JSON, ≤ 1 MB each. Optional `"logo": "logo.png"`, PNG ≤ 2 MB.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"], "jsx": "react-jsx",
    "strict": true, "isolatedModules": true, "skipLibCheck": true, "noEmit": true, "types": []
  },
  "include": ["src"]
}
```

`src/env.d.ts`:

```ts
declare const __WIDGET_TAG__: string;
declare const __CSS_MODE__: 'shadow' | 'light';
declare module '*.css' { const css: string; export default css; }
```

`build.mjs`:

```js
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssMode = process.argv.includes('--shadow') ? 'shadow' : 'light';
const config = JSON.parse(readFileSync(join(here, 'portal-widget.json'), 'utf8').replace(/^\uFEFF/, ''));
const tag = config.tagName;
const full = join(here, config.custom.fullBundlePath);
const light = join(here, config.custom.lightBundlePath);
const entry = ['main.tsx', 'main.ts'].map(f => join(here, 'src', f)).find(existsSync);

// Accepted by the upload dialog and `validate`, rejected by the Portal at runtime.
if (/\d|light|full/.test(tag)) throw new Error(`tagName "${tag}": no digits, no "light"/"full".`);
if (config.version !== '1.0.0') throw new Error('version must be "1.0.0" for a private widget.');
if (!entry) throw new Error('Missing src/main.ts or src/main.tsx.');

// Light mode: prefix every selector with [tag], map :host to [tag], wrap in @layer widgets.
function scopeCss(css) {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@[a-z-]+/i.test(flat)) throw new Error('styles.css must be flat: no @media/@keyframes/@font-face/@import/@layer.');
    const scoped = flat.replace(/([^{}]+)\{/g, (_, list) => list.split(',').map(s => s.trim()).filter(Boolean)
        .map(s => (s.startsWith(':host') ? `[${tag}]${s.slice(5)}` : `[${tag}] ${s}`)).join(', ') + ' {');
    return `@layer widgets {\n${scoped.trim()}\n}`;
}

mkdirSync(dirname(full), { recursive: true });
await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', minify: true, sourcemap: false, outfile: full,
    define: { __WIDGET_TAG__: JSON.stringify(tag), __CSS_MODE__: JSON.stringify(cssMode), 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'css', setup(b) {
        b.onLoad({ filter: /\.css$/ }, a => {
            const css = readFileSync(a.path, 'utf8');
            return { contents: cssMode === 'light' ? scopeCss(css) : css, loader: 'text' };
        });
    } }]
});

const out = readFileSync(full, 'utf8');
if (!out.includes('customElements.define(') || !(out.includes(`"${tag}"`) || out.includes(`'${tag}'`))) {
    throw new Error('Bundle must call customElements.define() with the tag as a string literal (pack checks this).');
}
if (statSync(full).size > 10 * 1024 * 1024) throw new Error('Bundle exceeds the 10 MB upload limit.');
copyFileSync(full, light); // non-Angular: full and light are the same file
console.log(`[${tag}] bundles written (css: ${cssMode})`);
```

## 4. Write the widget

`src/main.ts` (a tile plus the settings form the Portal shows in its dialog):

```ts
import { defineConfigSchema, definePortalWidget, withDefaults, type WidgetContext } from '@serviceware/portal-widget-sdk';
import styles from './styles.css';

interface Settings { title: string }
const schema = defineConfigSchema<Settings>({ title: { type: 'string', default: 'My Widget' } });

const esc = (v: string) => v.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function paint(ctx: WidgetContext<Settings>): void {
    const s = withDefaults(ctx.inputs.configuration, schema);
    if (ctx.inputs.hidden) {
        ctx.root.innerHTML = '';
    } else if (ctx.inputs.settingsMode) {
        // Separate element instance inside the Portal's settings dialog.
        ctx.root.innerHTML = `<form class="mw-box"><label>Title <input name="title" maxlength="100"></label>
            <div><button>Save</button> <button type="button" data-cancel>Cancel</button></div></form>`;
        const form = ctx.root.querySelector('form')!;
        const input = form.elements.namedItem('title') as HTMLInputElement;
        input.value = s.title;
        form.addEventListener('submit', e => { e.preventDefault(); ctx.save({ title: input.value.trim() }); });
        form.querySelector('[data-cancel]')!.addEventListener('click', () => ctx.cancel());
    } else {
        ctx.root.innerHTML = `<section class="mw-box"><h2 class="mw-title">${esc(s.title)}</h2>
            <button data-toast>Toast</button>${ctx.inputs.showSettingsButton ? ' <button data-settings>Settings</button>' : ''}</section>`;
        ctx.root.querySelector('[data-toast]')!.addEventListener('click', () => ctx.toast.success('It works.'));
        ctx.root.querySelector('[data-settings]')?.addEventListener('click', () => ctx.openSettings());
    }
}

definePortalWidget<Settings>({
    tag: __WIDGET_TAG__,
    cssMode: __CSS_MODE__, // pass explicitly: the SDK default is 'shadow'
    styles,
    configSchema: schema,
    render(ctx) {
        paint(ctx);
        return () => { ctx.root.innerHTML = ''; };
    },
    onInputsChange(changed, ctx) {
        // Don't wipe what the admin is typing on unrelated input changes.
        if (ctx.inputs.settingsMode && !('settingsMode' in changed) && !('hidden' in changed)) return;
        paint(ctx);
    }
});
```

`src/styles.css` (flat; build.mjs scopes it):

```css
.mw-box { box-sizing: border-box; height: 100%; padding: 1rem; display: flex; flex-direction: column; gap: .75rem; }
.mw-title { margin: 0; font-size: 1.25rem; }
```

**Settings schema.** Each field has `type`: `'string'`, `'number'`, `'boolean'` or `'json'` (for arrays
and objects). Optional `default` and `secret: true` are allowed. There's no `'array'` type. Example for a list:

```ts
interface Link { label: string; url: string }
interface Settings { title: string; links: Link[] }
const schema = defineConfigSchema<Settings>({
    title: { type: 'string', default: 'Links' },
    links: { type: 'json', default: [] }
});
```

**Where settings live.** Saved settings are `ctx.inputs.configuration.customConfig`, and they're public.
`withDefaults(ctx.inputs.configuration, schema)` takes the **whole configuration object**, not
`customConfig`, and fills in the defaults for missing fields. `ctx.save(next)` replaces all of
`customConfig`, so always pass every field. The schema doesn't validate values: treat `customConfig` as
untrusted input, check types (`Array.isArray`), and sanitize URLs to `http(s):`/`mailto:` before
rendering them as links.

What `ctx` offers:

| Need | Use |
|---|---|
| Mount point | `ctx.root` (the element in light mode, its shadow root in shadow mode) |
| Inputs | `ctx.inputs.configuration`, `language`, `availableLanguages`, `settingsMode`, `showSettingsButton`, `isAdminMode`, `portalEditionMode`, `portalScreenLayout` (`desktop`/`tablet`/`mobile`), `hidden`, `apiUrl`, `authToken` |
| Settings with defaults | `withDefaults(ctx.inputs.configuration, schema)` |
| Persist / abort settings | `ctx.save(customConfig)` / `ctx.cancel()`, only in settings mode |
| Open the settings dialog | `ctx.openSettings()`; show the trigger only if `showSettingsButton` |
| Toasts | `ctx.toast.success / info / warning / error(detail, summary?)` |
| Portal API as the current user | `ctx.fetch(`${ctx.inputs.apiUrl}/…`)`: bearer token only for `apiUrl` URLs |
| Uploaded translations | `await ctx.loadTranslations(ctx.inputs.language)` |
| Grid resize | `ctx.onResize(({ width, height }) => …)` |
| Navigation, skeleton | `navigate(route, query?)`, `showSkeleton(id)`, `hideSkeleton(id)` from the package root |
| Redacted logging | `debugConfig(ctx.inputs.configuration, schema)` |
| User | `ctx.inputs.configuration.userProfile?.firstName` (personal data: render only) |

Rules: render settings UI only when `settingsMode` is true, and never add your own admin checks. Re-render
in `onInputsChange` (`ctx.inputs` is not reactive), respect `hidden`, escape text you put into `innerHTML`,
and fill the tile (`height: 100%`).

**Frameworks**: mount into `ctx.root` and feed `onInputsChange` into framework state. Entry `src/main.tsx`
for React.
- React: `const r = createRoot(ctx.root); r.render(<App/>)` in `render`, `r.unmount()` in the cleanup. Snapshot
  `{ ...ctx.inputs }` into a small store read with `useSyncExternalStore`, and keep one root/store per element
  (`WeakMap<HTMLElement, …>`), because the tile and the settings dialog are two instances.
- Vue: `createApp(App, { ctx }).mount(ctx.root)` + `reactive()` store; no SFC `<style>` in light mode.
- Lit: `render(html\`…\`, ctx.root)` in both hooks. Svelte: `mount(App, { target: ctx.root, props })`.
- Pre-rendered HTML (Astro): build HTML at build time, import it as a string, set `innerHTML`.

## 5. CSS isolation (mandatory)

Widgets share the document with the Portal, and unlayered CSS beats every Portal layer. Use **light mode**
(the default): build.mjs puts every selector under `[<tag>]` inside `@layer widgets`, which the Portal's
compliance probe requires.
- Keep `styles.css` flat (no at-rules). Instead of `@media`, use classes toggled from `portalScreenLayout`.
- Style only classes you own, never `html`/`body`/`:root`. No runtime CSS-in-JS. Don't append elements to
  `document.body`.
- Shadow mode (`node build.mjs --shadow`) isolates fully, but the probe logs a warning today. Only use it
  if the user asks.

## 6. Secrets and data (hard rules)

- The bundle, `customConfig` and translation files are **public** to every visitor. No API keys, passwords
  or private tokens in them. Mark such fields `secret: true` in the schema, and `ctx.save` will throw
  `SecretInConfigError` if they are non-empty.
- `authToken` is the user's Portal session. Only send it to `apiUrl` (via `ctx.fetch`); never forward or
  store it.
- **No released Portal can call a third-party API with a private key securely** (there's no Service
  Connection proxy in production). Tell the user plainly. An **experimental** `ctx.service('<connection
  name>')(path)` exists for Portals running the backend proof of concept (`poc/widget-connection-proxy`,
  docs/service-connection-proxy.md). The admin stores the key in a Service Connection. The widget's settings view
  lists connections via `ctx.fetch('api/v2/admin/serviceconnections')` and links the chosen one with
  `ctx.save(customConfig, { serviceConnectionsId: [id] })`; `customConfig` holds only the id. Offer it only if the user confirms their Portal has
  that backend, and never as a production solution. The options are a key that is public by design and referrer-restricted
  (can go in `customConfig`, documented as public), or their own backend that holds the key and validates the
  forwarded Portal token.
- No `.env` files, no source maps, bundles < 10 MB.

## 7. Build, validate, pack

```bash
npm install
npm run build                              # bundles/<tag>-1.0.0-{full,light}.js
npx portal-widget validate portal-widget.json
npx portal-widget pack                     # -> <tag>.zip
npx portal-widget validate <tag>.zip       # a "preludeMissing" warning is expected for custom widgets
```

Fix every **error** and rerun. Before you report done, check: tag rules, `version` 1.0.0, `angularVersion` 0,
no secrets, flat scoped CSS, settings UI only under `settingsMode`.

To try the widget in a local Portal mock (inputs, toasts, settings dialog, layout switch, compliance probe),
get these files from the SDK repository:
- `examples/react-live-counter/dev/index.html` and `dev/harness.ts`, into your `dev/`
- `examples/serviceware-logo-three/build.mjs`, saved as `harness-build.mjs` (entry `src/main.ts`)

They're on `https://raw.githubusercontent.com/Serviceware/portal-widget-sdk/main/<path>` or in a checkout.
Run `node harness-build.mjs --serve` and open `http://localhost:4201`. If you have a browser tool, check
the tile, open the settings, save, confirm the tile updates, and switch the layout to mobile.

## 8. Import (tell the user; it needs a Portal admin)

1. Requires the `private-widgets` feature flag. Open Portal **Home** first, then **Administration →
   Configuration → Widgets** (`admin/configuration?tab=4`). Deep-linking there directly can hide the button.
2. Click the **small arrow** next to **Add private widget** → Import → pick `<tag>.zip` → Upload.
3. Place it on a page. Its settings are the gear in the **page configuration panel's** widget list, not on
   the tile.
4. The console must show no `[Widget Compliance]` warning.
5. Updating: Import refuses an existing tag. Use **Edit** on the widget, or delete and re-import. For quick
   iteration, override `…/storage/v1/widgets/<tag>-1.0.0-full.js` in Chrome DevTools → Sources → Overrides.

## 9. Embed path (no code)

```bash
printf 'embed\nIT Status\nhttps://status.example.com\n' | npx portal-widget
```

Writes `portal-widget.json` and `ssp-it-status.zip`. If the derived tag has digits or `light`/`full`, edit
`tagName` and run `npx portal-widget pack`. Import as in section 8. The target site must allow framing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank tile, no error | The ZIP's tag doesn't match the registered tag: use `__WIDGET_TAG__`, rebuild, re-pack |
| Blank tile, `.js` 404 | `version` isn't 1.0.0, or the tag has digits / `light` / `full` |
| Tile doesn't update after the admin saves | Re-render on `changed.configuration` in `onInputsChange` |
| Save does nothing | Only call `ctx.save` in settings mode; a non-empty `secret` field makes it throw |
| `[Widget Compliance]` warning, Portal styles changed | Unscoped or unlayered CSS: use light mode and a flat `styles.css`, and don't add your own `<style>` tags (the SDK's `<style data-portal-widget>` is expected) |
| No "Add private widget" button | Feature flag off, or you deep-linked: go Home first |
| Upload greyed out | A language file > 1 MB, or the tag already exists (use Edit) |
| Import menu entry shows `widgets_management_import_private_widget` | Missing Portal translation, harmless |
| `pack`: tag not found in bundle | The tag must appear as a string literal: use the build define |
| CLI: malformed JSON at `{` | The file has a UTF-8 BOM: resave without it |
