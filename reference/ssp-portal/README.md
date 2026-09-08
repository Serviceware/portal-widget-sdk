# Snapshots from SSP_Portal (internal reference)

Copied verbatim from `SSP_Portal` branch `portal30`, commit `5db6e508e74cea4056032c62f1b47f9066a72ead`.
The last two rows were added from branch `feature/private-widget-toolkit`, commit `b47f4036`, where the
other snapshots are byte-identical to `portal30`.

Two CLI specs read snapshots from here instead of the live Portal sources they read inside the monorepo:
`rules-drift.spec.ts` (dialog + validators) and `scaffold-template.spec.ts` (`elements-build-script.js`).
Refreshing a snapshot with a changed Portal limit therefore fails those specs until `rules.ts` or the
scaffold template is updated -- that is the drift guard working as intended.
They document the behaviour the CLI and SDK port. **Not used at runtime. Remove this folder before the
repository is made public** and re-check `docs/reference-sources.md` instead.

| File | Original path | Ported by |
|---|---|---|
| `postcss-widget-scope-plugin.js` | `libs/utils/src/shared/postcss-widget-scope-plugin.js` | cli CSS pipeline (docs/css-isolation.md §3) |
| `build-styles.js` | `libs/utils/src/shared/build-styles.js` | cli CSS emit step |
| `elements-build-script.js` | `libs/utils/src/shared/widgets/elements-build-script.js` | cli `build` (layer order, concat, token shield idea) |
| `rename-widget.js` | `.scripts/rename-widget.js` | cli `build` file naming, light-mode CSS injection |
| `webpack.externals.js` | `libs/utils/src/shared/widgets/webpack.externals.js` | future Angular preset (`--light-externals`) |
| `prepare-widget-release.ts` | `libs/utils/src/shared/tools/prepare-widget-release.ts` | cli `release` |
| `widget-package.service.ts` | `libs/admin/src/lib/widgets-management/services/widget-package/widget-package.service.ts` | cli `pack` (zip format) |
| `event-manager.ts` | `libs/ssp-core/src/event-manager.ts` | sdk events |
| `widget-compliance.ts` | `libs/common/src/lib/page/containers/widget/utils/widget-compliance.ts` | css-isolation.md §1/§5 |
| `widget.component.html` | `libs/common/src/lib/page/containers/widget/widget.component.html` | sdk element inputs/outputs |
| `auth-interceptor.ts` | `libs/utils/src/lib/services/auth-interceptor/auth-interceptor.ts` | sdk `createPortalFetch` |
| `widget-management-add-private-widget-dialog.component.ts` | `libs/admin/src/lib/widget-management/components/widget-management-add-private-widget-dialog/widget-management-add-private-widget-dialog.component.ts` | cli `rules.ts` mirror; read by `rules-drift.spec.ts` |
| `portal-validators.ts` | `libs/common/src/lib/shared/utils/portal-validators.ts` | cli `rules.ts` mirror; read by `rules-drift.spec.ts` |
