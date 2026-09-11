import { defineConfig } from 'astro/config';

/**
 * Astro renders src/pages/[lang]/*.astro to plain HTML under dist-astro/. build.mjs then lifts the
 * <body> and the inlined <style> blocks into the widget bundle, so everything must end up inline:
 * no external stylesheets, no client scripts.
 */
export default defineConfig({
    output: 'static',
    outDir: './dist-astro',
    build: {
        inlineStylesheets: 'always',
        format: 'directory'
    },
    // Attribute selectors keep the scoped CSS flat so build.mjs's light-mode scoper can prefix it.
    scopedStyleStrategy: 'attribute',
    compressHTML: true,
    devToolbar: { enabled: false }
});
