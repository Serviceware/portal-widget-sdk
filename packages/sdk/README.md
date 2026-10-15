# @serviceware-oss/portal-widget-sdk

Zero-dependency runtime for building Serviceware Portal **private widgets** with any framework.

```bash
npm install @serviceware-oss/portal-widget-sdk
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
import { definePortalWidget, defineConfigSchema } from '@serviceware-oss/portal-widget-sdk';
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

## Third-party APIs and credentials (read this first)

A widget runs in the visitor's browser. Anything it can read, the visitor can read: the bundle,
`configuration.customConfig`, translation files, and every request the widget sends. **A private API key or
credential must never be in the widget.**

On **Portal 3 with the Service Connection proxy** the Portal holds the credential:

1. The Portal admin creates a Service Connection (base URL plus an API key header or query parameter, bearer
   token, basic auth, OAuth 2.0 client credentials, or forwarding the user's Portal token) and links it to
   the widget in the widget settings.
2. Your widget stores only the connection id or name in `customConfig` and calls it:

```ts
// in a click handler or any async function that has the widget context
const res = await ctx.service('weather')('forecast?city=Bonn'); // the Portal adds the key server-side
ctx.serviceConnections(); // [{ id, name, module, mode, modeName, isDefault, hasCredentials, allowAnonymous, url }]
```

The response comes back unchanged. Non-2xx means the call failed (`401`, `404`, `429` with `Retry-After`,
`502`, `504` from the Portal, or any upstream status); the SDK never retries. On anonymous pages the call works
only for connections the admin allowed for anonymous use. Details:
[`docs/service-connection-proxy.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/service-connection-proxy.md).

| Need | Safe approach |
|---|---|
| Call the **Portal API** as the current user | `ctx.fetch` / `createPortalFetch` attach the user's Portal token, only for `apiUrl` requests. |
| Call a third-party API with a **private** key or secret | `ctx.service(connection)` on a Portal with the Service Connection proxy. Without it: a backend you control that holds the key and validates the Portal bearer token the widget forwards. |
| Use a key that is **public by design** (maps, analytics, public tokens restricted by referrer or origin) | Store it in `customConfig`, and document that every visitor can see it. |
| Per-user login to a third party | Bring your own OAuth/OIDC flow in the browser. Out of scope for SDK v1. |

The `secret: true` schema flag exists so you cannot persist a key into `customConfig` by accident:
`save()` throws `SecretInConfigError` if such a field is non-empty.

## Security notes (read before shipping)

- Everything in `customConfig` is visible to every visitor of the page.
- `authToken` is the user's Portal session. The SDK only ever sends it to the Portal API.
- Never forward `authToken` to any origin other than the Portal API.
- Private API keys belong in a Service Connection, not in the widget (section above). See
  [`docs/security.md`](https://github.com/Serviceware/portal-widget-sdk/blob/main/docs/security.md).

## License

MIT. Source, issues and the full documentation:
[github.com/Serviceware/portal-widget-sdk](https://github.com/Serviceware/portal-widget-sdk).
