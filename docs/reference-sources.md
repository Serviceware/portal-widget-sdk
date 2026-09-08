# Where the contract was verified

Repository `SSP_Portal`, branch `portal30`, commit `5db6e508e74cea4056032c62f1b47f9066a72ead`
(local checkout `C:\GitSources\SSP_Portal`). Re-check these when the Portal changes.

| Fact | Source |
|---|---|
| Window events are `CustomEvent`s on `window`, type = name + `SSPEvent`, payload in `detail`, `handled` flag | `libs/ssp-core/src/event-manager.ts` |
| Event names | `libs/utils/src/lib/models/enums/events.enum.ts` |
| Toast payload `{ message: ToastOptions }`, default lifetimes | `libs/utils/src/lib/services/toast/toast.service.ts`, `libs/utils/src/lib/models/events/toast/show-toast-event.ts`, `libs/utils/src/lib/models/interfaces/toast.interface.ts` |
| Shell renders toasts | `apps/admin/src/app/app.component.ts` `listenToastEvent()` (~line 554) |
| Show-config-modal payload = `WidgetConfigInterface` spread; shell `structuredClone`s and opens dialog | `libs/utils/src/lib/models/events/config/*.ts`, `apps/admin/src/app/app.component.ts` `subscribeToShowConfigModal()` (~line 467) |
| Navigate payload | `libs/utils/src/lib/models/events/navigate-route-event.ts`, `libs/common/src/lib/core/services/navigation/navigation.service.ts` |
| Skeleton events, resize event | `libs/utils/src/lib/models/events/skeleton/*.ts`, `resize-event.ts`; host listener in `libs/common/src/lib/page/containers/widget/widget.component.ts` |
| Element inputs and outputs | `libs/common/src/lib/page/containers/widget/widget.component.html` |
| `WidgetConfigInterface`, `WidgetVersionBaseInterface`, `ServiceConnection`, `Security` | `libs/utils/src/lib/models/interfaces/widget-config.interface.ts`, `.../base/widget-version.base.interface.ts`, `libs/utils/src/lib/models/types/service-connection.ts`, `security.ts`, `security-mode.ts` |
| Bearer only for `apiUrl` prefix | `libs/utils/src/lib/services/auth-interceptor/auth-interceptor.ts` |
| Bundle URL `{apiURL}/storage/v1/widgets/{fileName}`, classic script, host attribute stamping, compliance call | `libs/common/src/lib/page/containers/widget/widget.component.ts` `ngOnInit` |
| Light vs full pick rule | `libs/common/src/lib/page/containers/widget/utils/widget-utils.ts` `getFileName` |
| Globals exposed for light builds | `libs/common/src/shared-dependencies-enum.ts`, `libs/common/src/expose-global-modules.ts`, `libs/utils/src/shared/widgets/webpack.externals.js` |
| Compliance probe rules | `libs/common/src/lib/page/containers/widget/utils/widget-compliance.ts` |
| Layer order | `libs/utils/src/shared/widgets/elements-build-script.js` `PORTAL_LAYER_ORDER`, `libs/common/src/lib/assets/styles/styles.scss` |
| CSS scoping pipeline | `libs/utils/src/shared/postcss-widget-scope-plugin.js`, `build-styles.js`, `.scripts/rename-widget.js` |
| CSS isolation narrative | `libs/utils/docs/css-isolation.md` |
| Translations endpoint and `x-sw-language` header | `libs/utils/src/lib/services/translate/translate.service.ts` |
| Widget metadata schema | `widgets/widget-metadata.schema.json` (copied to `schemas/`) |
| Zip format | `libs/admin/src/lib/widgets-management/services/widget-package/widget-package.service.ts` |
| Import DTO shape | `libs/admin/src/lib/widgets-management/models/widget-metadata.dto.ts`, `widget-upload-form.dto.ts`, `libs/utils/src/lib/models/types/multilanguage-data.ts` |
| Import draft mapping, limits (10 tags, 10 deps) | `libs/admin/src/lib/widget-management/services/private-widget-dialog.service.ts` |
| Dialog limits (100/4000 chars, `en` required), translation file validation | `libs/admin/src/lib/widget-management/components/widget-management-add-private-widget-dialog/*.component.ts`, `libs/admin/src/lib/widgets-management/components/upload-widget-dialog/*.component.ts` |
| Upload endpoint and multipart fields | `libs/admin/src/lib/widgets-management/services/widget-management/widget-management.service.ts` `createFormDataFromDto`, `uploadPrivateWidget` |
| Release tool behaviour | `libs/utils/src/shared/tools/prepare-widget-release.ts`, `libs/utils/docs/PREPARE_WIDGET_RELEASE.md` |
| Local testing flows | `widgets/DEVELOPING.md`, `libs/utils/docs/index.md` §4 |
| CSP (`connect-src *`) | `nginx/templates/nginx.conf.template` |
| Private feeds for `@ssp`, `@sw`, `@codeblue` | `.npmrc` |

## Backend (`Portal_Backend`, branch `main`, commit `197d372`, `src/Portal/`)

Details and conclusions in [backend-findings.md](backend-findings.md).

| Fact | Source |
|---|---|
| Gateway proxy only for `sabio`/`messaging`, host rewrite only, no header injection | `hosting/Portal.ApiGateway/Middlewares/ServiceConnectionsApiHandler.cs` |
| Handler wiring per environment | `hosting/Portal.ApiGateway/Helpers/ServiceCollectionExtensions.cs`, `ocelot.dockercompose.json`, `ocelot.nomad.json` |
| `Security` stored as plain JSON | `business/Portal.Domain/ServiceConnections/Commands/AddServiceConnection/AddServiceConnectionCommandHandler.cs:56`, `UpdateServiceConnection/UpdateServiceConnectionCommandHandler.cs:44`, `Models/Security.cs`, `Models/Header.cs` |
| Full `ServiceConnections` attached to every route widget | `business/Portal.Domain/RouteWidgets/Helpers/RouteWidgetHelper.cs`, `Models/Helpers/ServiceConnectionMapper.cs`, `Models/RouteWidget.cs` |
| Route widgets embedded in page route response | `business/Portal.Domain/Routes/Helpers/RouteHelper.cs:69` |
| Anonymous config endpoints, no fallback policy | `hosting/Portal.Api/Controllers/ConfigController.cs`, `hosting/Portal.Api/Program.cs` (`AddCustomAuthorization`) |
| Admin-only service connection CRUD | `hosting/Portal.Api/Controllers/ServiceConnectionsController.cs` |
| Private widget upload endpoints and command shape | `hosting/Portal.Api/Controllers/WidgetController.cs:249-337`, `business/Portal.Domain/Widget/Commands/AddPrivateWidget/AddPrivateWidgetCommand.cs` |
| Server validation for private widgets | `business/Portal.Domain/Widget/Commands/Validators/AddPrivateWidgetValidator.cs` |
| Fixed version `1.0.0`, stored file names | `AddPrivateWidgetCommandHandler.cs:24,131-132`, `UpdatePrivateWidgetCommandHandler.cs:25,144-145` |
| Minio object paths for bundles and translations | `business/Portal.Domain/Helpers/MinioUploadHelper.cs` (`UploadJavaScriptFileAsync`, `UploadLanguageFileAsync`) |
| Private bundle path resolution from requested file name | `business/Storage.Domain/Widget/GetWidgetQueryHandler.cs` (`GetPrivateWidgetPath`) |
| Translation resolution (private path ignores version, base-language fallback) | `business/Storage.Domain/Language/GetLanguageForWidgetQueryHandler.cs` |
| Storage endpoints anonymous | `hosting/Storage.Api/Controllers/StorageController.cs:135-258` |
| Default connections have no headers | `data/Portal.Migration/Service/DefaultServiceConnectionsMigratorService.cs:18` |
