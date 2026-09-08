# @serviceware/portal-widget-sdk

Zero-dependency runtime for building Serviceware Portal **private widgets** with any framework.

```bash
npm install @serviceware/portal-widget-sdk
```

ESM and CommonJS builds with type declarations. Browser only, no framework imports, works with vanilla TS,
React, Vue, Lit, Svelte or Angular.

> **Status: 0.x.** The runtime specified in
> [`docs/sdk.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/sdk.md) is implemented and
> covered by jsdom specs that assert the exact event names and payload shapes of the Portal contract. It has
> not yet been verified inside a live Portal; expect breaking changes before 1.0. Contract:
> [`docs/contract.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/contract.md).
> Walkthrough:
> [`docs/getting-started.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/getting-started.md).
> Working example:
> [`examples/serviceware-logo-three`](https://github.com/Serviceware/portal-widget-sdk/tree/main/examples/serviceware-logo-three).

## Usage

```ts
import { definePortalWidget, defineConfigSchema } from '@serviceware/portal-widget-sdk';
import styles from './styles.css'; // a CSS string; see the example's build.mjs for light-mode scoping

const schema = defineConfigSchema<{ greeting: string }>({
  greeting: { type: 'string', default: 'Hello' },
});

definePortalWidget({
  tag: 'acme-hello-widget',
  styles,
  configSchema: schema,
  render(ctx) {
    const { greeting } = ctx.inputs.configuration.customConfig;
    ctx.root.innerHTML = `<button id="hi">${greeting}</button>`;
    ctx.root.querySelector('#hi')!.addEventListener('click', () => ctx.toast.success('Hi from a widget'));
  },
  onInputsChange(changed, ctx) {
    if (changed.settingsMode) { /* render settings UI, call ctx.save(newConfig) */ }
  },
});
```

## No secure third-party authentication yet (read this first)

**There is currently no secure way for a widget to call a third-party API with a private key or
credential.** This is a Portal limitation, not something the SDK can work around:

- A widget runs in the visitor's browser. Anything it can read, the visitor can read: the bundle,
  `configuration.customConfig`, translation files, and every request the widget sends.
- The Portal's Service Connections store credentials server-side, but the Portal has **no proxy** that
  injects them into widget requests, and today it even returns the stored header values to anonymous
  visitors through its configuration endpoints (see
  [`docs/backend-findings.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/backend-findings.md)
  sections 1 and 2).
- Therefore the SDK ships **no** `createServiceClient` and no helper for API keys. It will be added when
  the Portal provides the server-side proxy.

What you can do today:

| Need | Safe approach |
|---|---|
| Call the **Portal API** as the current user | `ctx.fetch` / `createPortalFetch` attach the user's Portal token, only for `apiUrl` requests. |
| Use a key that is **public by design** (maps, analytics, public tokens restricted by referrer or origin) | Store it in `customConfig`, and document that every visitor can see it. |
| Use a **private** key or secret | Not from the browser. Put the key in a backend you control, have that backend validate the Portal bearer token the widget forwards, and call the third party from there. |
| Per-user login to a third party | Bring your own OAuth/OIDC flow in the browser. Out of scope for SDK v1. |

The `secret: true` schema flag exists so you cannot persist a key into `customConfig` by accident:
`save()` throws `SecretInConfigError` if such a field is non-empty.

## Security notes (read before shipping)

- Everything in `customConfig` is visible to every visitor of the page.
- `authToken` is the user's Portal session. The SDK only ever sends it to the Portal API.
- Never forward `authToken` to any origin other than the Portal API.
- Private API keys do not belong in the widget at all until the Portal proxy exists (section above). See
  [`docs/security.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/security.md).

## License

MIT. Source, issues and the full documentation:
[github.com/Serviceware/portal-widget-sdk](https://github.com/Serviceware/portal-widget-sdk).
