# @serviceware/portal-widget-cli

## 0.1.0

### Minor Changes

- a962a14: Port the private-widget CLI from SSP_Portal's `libs/create-widget` (branch `feature/private-widget-toolkit`):
  the embed wizard, `pack` (embed bundles or your own), `validate` and `unpack`, together with the prebuilt
  `ng22` embed bundles and 130 specs, now on tsup + vitest + ESM and free of private packages (the Angular/CB3
  scaffold stays in SSP_Portal). Renamed the
  binary to `portal-widget`, the config file to `portal-widget.json` and the ZIP sidecar to `portal-widget.json.txt`.
