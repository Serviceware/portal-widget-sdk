# Guide for AI agents and contributors

## Ground rules

- `docs/contract.md` is the single source of truth for how a widget talks to the Portal. If code and
  contract disagree, the contract wins. If the contract and the Portal disagree, re-verify against the
  Portal sources listed in `docs/reference-sources.md` and fix the contract first.
- `packages/sdk` has **zero runtime dependencies** and no framework imports. Browser only. Never add
  Angular, React, RxJS or any UI library to it.
- `packages/cli` is Node ≥ 20 only. It must never import `packages/sdk` at runtime; it may share the
  `schemas/` folder.
- No private Serviceware packages anywhere (`@ssp/*`, `@codeblue/*`, `@sw/*`). This repo is meant to be
  public. The Angular/CB3 widget scaffold therefore stays in SSP_Portal
  (`docs/cli-port-from-ssp-portal.md`); `packages/cli/assets/embed/` holds only prebuilt bundles the Portal
  serves as-is.
- Secrets: read `docs/security.md` before touching anything that handles `configuration`, `authToken`,
  environment variables, or bundling. The guardrails there are requirements, not suggestions.
- CSS: read `docs/css-isolation.md` before touching the build pipeline. Every widget stylesheet must end up
  either inside a shadow root or scoped to `[<tag>]` inside `@layer widgets`. No exceptions.

## Conventions

- TypeScript strict. ESM first, CJS build only where a consumer needs it.
- Tests with vitest. SDK tests run in jsdom and assert exact event names and payload shapes from the
  contract.
- Versioning with changesets. Every user-facing change gets a changeset.
- `examples/*` are **not** in the root pnpm workspace. Each example is its own pnpm project
  (`pnpm-workspace.yaml` with `packages: [.]`, `link:../../packages/*` dependencies, own lockfile) so the
  root install never pulls framework dependencies. Use `pnpm install:examples` / `pnpm build:examples` /
  `pnpm lint:examples` at the root, or work inside one example folder. Do not add `workspace:*` there.
- Keep `reference/ssp-portal/` read-only. It holds only the two Portal source snapshots that
  `packages/cli/src/lib/rules-drift.spec.ts` reads; refresh them from a Portal checkout, never edit them.
  Do not add more snapshots: point at Portal paths in `docs/reference-sources.md` instead.
