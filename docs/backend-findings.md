# Backend findings (Portal_Backend)

Verified against `Portal_Backend` branch `main`, commit `197d372` (local checkout
`C:\GitSources\Portal_Backend`, solution `src/Portal/Portal.sln`). Answers the open backend questions from
[security.md](security.md) and adds storage rules the CLI must follow.

---

## 1. Is there a service-connection proxy a widget can use? — **Partially, and not usable for API keys**

`Portal.ApiGateway/Middlewares/ServiceConnectionsApiHandler.cs` is an Ocelot `DelegatingHandler` that:

- Recognises only two hard-coded modules by URL substring: path containing `sabio` → module `knowledge`,
  path containing `messaging` → module `messaging` (`GetModule`).
- Looks up the service connection (by `?serviceConnectionId=<guid>` or the module default) and **rewrites
  the request host** to the connection URL.
- **Never reads `Security.Headers`.** It forwards the incoming headers unchanged (including the user's
  Portal `Authorization` bearer) and adds nothing.
- Is attached per route in `ocelot.dockercompose.json` (`/messaging`, `/messaging/{everything}`) only. In
  `ocelot.nomad.json` no route lists any `DelegatingHandlers`, so on SCE the handler is not in the pipeline
  at all as configured today.

No other code path applies `Security.Headers`: a repo-wide search for consumers of `.Security` finds only
the mapper, the two serialisers in Add/Update handlers, and tenant export/import normalisation.

**Conclusion:** Tier 1 of `security.md` (server-held API keys injected by the Portal) **does not exist**.
It must be built. See §4 for a proposal.

---

## 2. Do header values leak to the browser? — **Yes, to anonymous visitors**

Chain, all verified:

1. `AddServiceConnectionCommandHandler.cs:56` / `UpdateServiceConnectionCommandHandler.cs:44` store
   `Security` as plain JSON (`{"Mode":2,"Headers":[{"Key":"x-api-key","Value":"…"}]}`) in
   `Serviceconnection.Security`. No encryption. The admin UI (`libs/admin/.../connections-management`)
   exposes modes None, BearerToken and Custom with free-form header key/value pairs.
2. `ServiceConnectionMapper.MapToServiceConnection` copies `Security` verbatim into the domain model.
3. `RouteWidgetHelper.GetRouteWidgetModel` (`Portal.Domain/RouteWidgets/Helpers/RouteWidgetHelper.cs`)
   attaches `ServiceConnections` (full objects) to **every** `RouteWidget` model it builds.
4. `RouteHelper.cs:69` puts those route widgets into the `Route` model when `showWidgets` is true.
5. `ConfigController` (`Portal.Api/Controllers/ConfigController.cs`) has **no `[Authorize]`** on the
   controller or on `GET api/v1/config/Routes/{path}`, `GET api/v1/config/RouteWidgets`,
   `GET api/v1/config/RouteWidgets/{id}`. `Portal.Api/Program.cs` defines named policies only; there is no
   fallback/default authenticated-user policy.
6. The frontend calls exactly these for page rendering: `router.service.ts:180`
   (`api/v1/config/routes/{path}`) and `widgets-common.service.ts:24` (`api/v1/config/routewidgets/{id}`).

Result: any route widget linked to a service connection with `Custom` or `BearerToken` security exposes
the header values (API key or bearer token) to every visitor of that page, anonymous included. Responses
are also cached in Redis with the values inside (`GetRouteWidgetByRouteIdQueryHandler`,
`GetRouteWidgetByIdQueryHandler`, `GetServiceConnectionsByRouteWidgetIdQueryHandler`).

Mitigating factor today: default connections are created with `{"Mode": 0, "Headers": null}`
(`DefaultServiceConnectionsMigratorService.cs:18`), and in-repo widgets do not use header-based
connections. The exposure exists as soon as an admin configures one.

**Fix (small, backend):** never serialise header values into read models.

- In `ServiceConnectionMapper.MapToServiceConnection`, or better in a dedicated public DTO used by
  `RouteWidgetHelper`, map `Security` to `{ mode, headerNames: [...] }` and drop values.
- Keep values only for admin endpoints that need them (`ServiceConnectionsController` GET by id, admin
  policy) — and consider masking there too, since the UI only needs to know a value is set.
- Invalidate the `RouteWidgets` cache key group after deploy (existing helper:
  `cacheService.DeleteCacheKey("RouteWidgets")`).
- Add a unit test on `RouteWidgetHelper` asserting no `Value` survives.

---

## 3. Private widget server-side rules (affect CLI `build`, `validate`, `pack`)

Source: `Portal.Domain/Widget/Commands/AddPrivateWidget/*`, `UpdatePrivateWidget/*`,
`Validators/AddPrivateWidgetValidator.cs`, `Helpers/MinioUploadHelper.cs`,
`Storage.Domain/Widget/GetWidgetQueryHandler.cs`, `Storage.Domain/Language/GetLanguageForWidgetQueryHandler.cs`.

| Rule | Where | Consequence for the SDK/CLI |
|---|---|---|
| Version is **always `1.0.0`** for private widgets. `Add` hard-codes it, `Update` keeps the existing number. Semver in `widget-metadata.json` is not sent and not stored. | `AddPrivateWidgetCommandHandler.cs:24`, `UpdatePrivateWidgetCommandHandler.cs:25` | `release`/bump is local bookkeeping only. Portal shows `1.0.0`. Document it. |
| Bundles are stored at `{tenantId}/widgets/{tag}/{full\|light}/{tag}-1.0.0-{full\|light}.js.gz` regardless of the uploaded file name. | `MinioUploadHelper.UploadJavaScriptFileAsync` | |
| DB `Filename`/`Filenamelight` = **uploaded file names** as-is. The frontend requests `storage/v1/widgets/{Filename}`. | `AddPrivateWidgetCommandHandler.cs:131-132` | |
| Storage resolves the private path from the **requested file name**: folder = `Regex ^[^0-9]*` minus last char, subfolder = `light` if the name contains `light` else `full`, path `{tenant}/widgets/{folder}/{sub}/{name}.gz`. | `GetWidgetQueryHandler.GetPrivateWidgetPath` | **The uploaded files must be named exactly `<tag>-1.0.0-full.js` and `<tag>-1.0.0-light.js`**, otherwise the object is not found (404) and the widget never loads. The CLI must emit these names for private widgets, whatever the metadata version says. |
| Tag name must contain **no digits** (regex cuts at the first digit → wrong folder) and must **not contain the substring `light`** (full bundle would be looked up under `/light/`). | same | `validate`: reject tags matching `[0-9]` or `/light/i`. Also reject `full` in the tag for symmetry. |
| Tag must be unique per tenant and not collide with global widget names. | `AddPrivateWidgetValidator` → `IsNameUniqueAsync` | Surface the 400 message clearly in a future `publish`. |
| `Name` and `Description` need an `en` entry; both files required, `.js` extension. | `AddPrivateWidgetValidator` | Already in `validate`. |
| Translation files: `.json`, file name (without extension) must be a valid .NET `CultureInfo` name (case-insensitive), e.g. `en`, `de`, `pt-BR`, `en-US`. | `AddPrivateWidgetValidator.HaveValidLanguageOrCultureInfo` | `validate`: check against a bundled list of culture names, not just a BCP-47 regex. |
| Translations stored at `{tenant}/widgets/{tag}/languages/{lang}.json.gz`, served by `GET storage/v1/widgets/{tag}/{anyVersion}/translations/{lang}` (private path ignores the version; falls back from `de-DE` to `de`). | `MinioUploadHelper.UploadLanguageFileAsync`, `GetLanguageForWidgetQueryHandler` | SDK `loadTranslations` can pass `usedVersion.number` (`1.0.0`). |
| Tags default to `["Private"]` if none sent. `EnvironmentType` optional. `Portalversion` left null so private widgets show on every Portal version. | `AddPrivateWidgetCommand`, handler | Nothing to do. |
| Upload endpoint `POST api/v2/admin/widgets/private` and `PUT api/v2/admin/widgets/private/{id}` require `portal-admin`; `[FromForm]` multipart, fields as in `contract.md` §9. | `WidgetController.cs:249-337` | Basis for a future `publish`. |
| `storage/v1/widgets/{name}` and the translations endpoint are **anonymous**. | `StorageController.cs:135-258` | Bundles are public. Already assumed in `security.md`. |

Minor backend inconsistencies noticed (not blocking):

- `MinioUploadHelper.DeleteFileFromMinio` builds a path (`{tenant}/widgets/{name}/{fileName}-{version}.gz`)
  that does not match the upload path (`.../{full|light}/{name}-{version}-{full|light}.js.gz`), so updates
  never delete the old object; they overwrite the same key anyway, so no functional issue.
- The light/full detection by substring (`Contains("light")`) is fragile for global widgets too.

---

## 4. Proposal: widget-facing service-connection proxy

Needed for Tier 1. Minimal design that fits the existing gateway:

- New Ocelot route `/api/v1/proxy/{connectionId}/{everything}` → Portal.Api (or handled in the gateway).
- Handler: authenticate the caller (any Portal user, or configurable per connection), load the connection
  by id **and verify it is linked to a route widget on a page the caller may see**, rewrite scheme/host/base
  path to `ServiceConnection.Url`, **strip the Portal `Authorization` header**, apply
  `Security.Headers` server-side, forward, stream the response back.
- Deny-list response headers that would leak (e.g. `Set-Cookie`), enforce a timeout and body size limit,
  log connection id but never header values.
- SDK: `createServiceClient(config, connectionIdOrName)` → `fetch(path)` targets
  `{apiUrl}/api/v1/proxy/{id}/{path}` with the Portal bearer (same-origin rule in `portalFetch` applies).

Until this exists, SDK docs state plainly that private API keys cannot be used securely from a widget.

---

## 5. Portal-side backlog items resulting from this analysis

1. **Security, high:** redact `ServiceConnection.Security` header values from all non-admin read models
   (§2). One PR, low risk.
2. **Feature:** widget-facing service-connection proxy (§4). Enables Tier 1.
3. **Robustness:** private widget storage should derive paths from stored metadata, not from parsing the
   requested file name; or at least validate/normalise uploaded file names to `<tag>-1.0.0-<kind>.js` on
   upload and reject tags with digits or `light`/`full` substrings (§3).
4. **Ops:** attach `ServiceConnectionsApiHandler` consistently across Ocelot environment files, or remove
   it if unused on SCE (§1).
5. **Portal shell:** shadow-DOM-aware compliance probe (from `css-isolation.md` §5).
