/**
 * Single point of truth for the package identity. The npm scope is
 * `@serviceware` (confirmed; docs/plan.md, decision 1). No other module in
 * this package may hardcode the package name string.
 */
export const PACKAGE_NAME = '@serviceware/portal-widget-cli';

export const CLI_BIN_NAME = 'portal-widget';

export const CONFIG_FILE_NAME = 'portal-widget.json';

/**
 * The in-ZIP sidecar entry name for the config file. Deliberately NOT a
 * `.json` suffix: the Portal's own unpack logic treats any `.json` entry
 * other than `widget-metadata.json` as a language file, and the stem
 * `portal-widget` passes `Intl.getCanonicalLocales` (a 6-letter language
 * subtag plus a 6-letter variant are both syntactically valid BCP 47), so a
 * bare `.json` sidecar would be carried along as a bogus translation. The
 * `.txt` suffix fails the Portal's `.json` filter outright. See README.md
 * for the full reasoning.
 */
export const ZIP_SIDECAR_ENTRY_NAME = 'portal-widget.json.txt';

export const DEFAULT_WIDGET_VERSION = '1.0.0';
