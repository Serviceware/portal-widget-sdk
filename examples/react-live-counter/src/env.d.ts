/** Injected by build.mjs via esbuild `define`. */
declare const __WIDGET_TAG__: string;
declare const __WIDGET_VERSION__: string;
declare const __CSS_MODE__: 'shadow' | 'light';

/** build.mjs loads .css files as text (already scoped in light mode). */
declare module '*.css' {
    const css: string;
    export default css;
}
