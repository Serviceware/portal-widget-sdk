/** Injected by build.mjs via esbuild `define`, one value per widget. */
declare const __WIDGET_TAG__: string;
declare const __AUTH_MODE__: import('@serviceware-oss/portal-widget-sdk').SecurityModeName;

/** build.mjs loads .css files as text, already scoped to the widget tag. */
declare module '*.css' {
    const css: string;
    export default css;
}
