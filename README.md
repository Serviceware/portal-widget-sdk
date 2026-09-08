# Portal Widget SDK

Public, framework-agnostic toolkit for building **private widgets** for Serviceware Portal.

> Status: **CLI ported from SSP_Portal and passing its tests; SDK runtime (Phase 1) implemented and unit-tested;
> first example widget (`examples/serviceware-logo-three`) builds, packs and runs in a Portal-mock harness. Not yet
> verified inside a live Portal.** Nothing is published yet. The npm scope is `@serviceware`. See
> [docs/plan.md](docs/plan.md).

## What this repo will ship

| Package | Purpose | Runs in |
|---|---|---|
| `packages/sdk` | Tiny, zero-dependency runtime: talk to the Portal (toasts, config modal, navigation, skeleton, resize), read the element inputs the Portal sets, authenticated fetch against the Portal API. | Browser |
| `packages/cli` | `portal-widget` command line, ported from SSP_Portal: no-code **embed** wizard (name + URL in, import ZIP out), `pack` (embed, or your own bundles built with any framework), `validate`, `unpack`. Framework-agnostic `init`/`build` are still design only (`docs/cli.md`). | Node ≥ 20 |

Widgets built with this SDK are uploaded through **Portal Admin → Widgets → Add private widget**, either
field by field or by importing the zip the CLI produces.

> **Known limitation:** a widget currently has **no secure way to authenticate against a third-party API**
> with a private key. Only calls to the Portal API as the current user are supported. The Portal-side
> proxy for Service Connections does not exist yet; see [packages/sdk/README.md](packages/sdk/README.md)
> and [docs/security.md](docs/security.md).

## Why a separate public repo

- The Portal monorepo's widget tooling (`@ssp/utils`, `@ssp/core`, `@codeblue/*`) lives on private Azure
  Artifacts feeds. A public npm package cannot depend on them.
- The Portal ↔ widget bridge is plain DOM: properties on a custom element and `CustomEvent`s on `window`.
  No Angular is required to implement it, so the SDK can stay zero-dependency and work with vanilla TS,
  React, Vue, Lit, Svelte, or Angular.

## Read in this order

0. [docs/getting-started.md](docs/getting-started.md) – build, test, pack and import your first widget, with
   any framework. Start here if you want to write a widget rather than work on the SDK.
1. [docs/contract.md](docs/contract.md) – the exact Portal ↔ widget contract (events, element I/O, bundle
   loading, light vs full, zip format). **Single source of truth for both packages.**
2. [docs/security.md](docs/security.md) – threat model, where secrets may and may not live, guardrails.
3. [docs/css-isolation.md](docs/css-isolation.md) – how widget CSS must be isolated so it never breaks the
   Portal and the Portal does not break it.
4. [docs/sdk.md](docs/sdk.md) – runtime API specification.
5. [docs/cli.md](docs/cli.md) – command line specification.
6. [docs/plan.md](docs/plan.md) – repo layout, tooling, phases, order of work, open decisions, Portal-side
   work items.
7. [docs/backend-findings.md](docs/backend-findings.md) – what the Portal backend actually does with service
   connections, private widget storage and file names; proposed backend fixes.
8. [docs/reference-sources.md](docs/reference-sources.md) – where every fact in the contract was verified in
   the Portal codebase, so it can be re-checked when the Portal changes.
9. [docs/cli-port-from-ssp-portal.md](docs/cli-port-from-ssp-portal.md) - what was ported from the Portal
   monorepo into `packages/cli`, what stayed behind and why, and the decisions the port leaves open.
10. [docs/handover-private-widget-toolkit.md](docs/handover-private-widget-toolkit.md) - the original
    author's handover: decisions already made and the traps that cost real time.

`reference/ssp-portal/` holds two verbatim Portal source snapshots that the CLI's `rules-drift.spec.ts`
reads to detect when a mirrored upload limit changes. Every other Portal source is referenced by path in
[docs/reference-sources.md](docs/reference-sources.md). Review whether the two files may stay before the
repository goes public.

## Repo layout

```
portal-widget-sdk/
  docs/                 specification and plan
  schemas/              JSON schemas for widget-metadata.json and the zip's widget-metadata.json
  packages/sdk/         runtime package (browser, zero deps)
  packages/cli/         command line package (node)
  examples/             end-to-end example widgets (serviceware-logo-three: three.js, exercises the whole SDK)
  reference/ssp-portal/ two Portal source snapshots read by the CLI drift spec (review before publishing)
```

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Tooling decisions (TypeScript, tsup, vitest, changesets, npm provenance) are described in
[docs/plan.md](docs/plan.md).

## License

MIT, see [LICENSE](LICENSE).
