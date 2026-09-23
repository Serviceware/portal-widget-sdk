---
"@serviceware/portal-widget-cli": minor
---

Add `portal-widget skill install`: installs the `portal-private-widget` coding-agent skill, shipped in the
package and matching this CLI version, into `.claude/skills/` and `.agents/skills/` of a project (`--dir`) or
the home directory (`--global`). `--target claude|agents` limits the targets. A locally modified copy is only
replaced with `--force`.
