# CLAUDE.md

This repository is the public Serviceware Portal private-widget toolkit: the SDK, the CLI, the contract and
an agent skill. Who you are working for decides what to read.

## Building a widget (widget authors)

When the user wants a widget ("build me a widget that…", "make a Portal tile for…", "pack/import my
widget"), read [`skills/portal-private-widget/SKILL.md`](skills/portal-private-widget/SKILL.md) and follow
it step by step. It is the only copy of the skill.

- Ask which Portal the widget is for (Portal 2 or Portal 3) unless the user said so; the skill's section 1
  explains what changes.
- Create the widget in its **own folder outside this repository** (for example a sibling folder named after
  the tag) unless the user names another place. Do not add it to `examples/` or to the root workspace.
- With an unpublished SDK, the skill's section 2 links the widget to this checkout's `packages/sdk` and
  `packages/cli`: run `pnpm install && pnpm build` here first.
- Do not change the SDK, CLI or contract to make a widget work. If the widget seems to need that, say so.

To get the skill as a slash command in Claude Code, run `/plugin marketplace add ./` in this checkout, then
`/plugin install portal-widget@serviceware`. Other projects: `npx @serviceware-oss/portal-widget-cli skill
install` (see the README).

## Working on the SDK itself (contributors)

[`AGENTS.md`](AGENTS.md) is binding: read it before changing anything. In short: `docs/contract.md` is the
source of truth, `packages/sdk` stays zero-dependency, no private Serviceware packages, no secrets, and a
skill change needs a CLI changeset plus a `version` bump in `.claude-plugin/plugin.json`.

Verify with `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm typecheck` at the root.
