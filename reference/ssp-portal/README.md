# Snapshots from SSP_Portal (test fixtures for the CLI drift guard)

Copied verbatim from `SSP_Portal` branch `portal30`, commit `5db6e508e74cea4056032c62f1b47f9066a72ead`.

Only two files are kept, because `packages/cli/src/lib/rules-drift.spec.ts` reads them: it asserts that
every limit and pattern mirrored in `packages/cli/src/lib/rules.ts` still appears in the Portal source it
was copied from. Refreshing a snapshot with a changed Portal limit fails that spec until `rules.ts`
follows, which is the drift guard working as intended. Not used at runtime.

| File | Original path | Mirrored in |
|---|---|---|
| `widget-management-add-private-widget-dialog.component.ts` | `libs/admin/src/lib/widget-management/components/widget-management-add-private-widget-dialog/widget-management-add-private-widget-dialog.component.ts` | `rules.ts` (tag/name/description/changes limits, tags, dependencies, size and angularVersion bounds, language subtag pattern) |
| `portal-validators.ts` | `libs/common/src/lib/shared/utils/portal-validators.ts` | `rules.ts` (file size ceilings, tag patterns) |

Every other Portal source the contract was verified against is listed by path and line in
[`docs/reference-sources.md`](../../docs/reference-sources.md); re-check there against a Portal checkout
instead of copying more files here. These two are Portal source code: review whether they may stay
before the repository is made public, or replace them with a checked-in extract of the constants.
