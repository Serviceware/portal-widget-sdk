/** Injected by build.mjs via esbuild `define`. */
declare const __WIDGET_TAG__: string;
declare const __WIDGET_VERSION__: string;
declare const __CSS_MODE__: 'shadow' | 'light';

/** Astro's rendered pages, collected from dist-astro/ by build.mjs and served as a virtual module. */
declare module 'virtual:astro-pages' {
    export interface AstroPages {
        /** Installed Astro version, e.g. "Astro v7.3.2". */
        generator: string;
        /** Language codes that were rendered, in dist-astro/ order. */
        languages: string[];
        /** `<body>` inner HTML of src/pages/[lang]/index.astro per language. */
        widget: Record<string, string>;
        /** `<body>` inner HTML of src/pages/[lang]/settings.astro per language. */
        settings: Record<string, string>;
    }
    const pages: AstroPages;
    export default pages;
}

/** All `<style>` blocks Astro inlined, deduplicated and (in light mode) already scoped. */
declare module 'virtual:astro-styles' {
    const css: string;
    export default css;
}
