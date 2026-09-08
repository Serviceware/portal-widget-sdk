'use strict';

/**
 * PostCSS plugin: scope all CSS selectors in a widget's full-build styles.css
 * to a widget-specific attribute selector.
 *
 * Why this exists: the full widget build emits styles.css as a base64-encoded
 * <link> appended to document.head.  Every selector inside leaks into Portal's
 * global cascade.  This plugin rewrites each selector so it only matches nodes
 * inside the widget container that carries [widgetName] (e.g. [ssp-launcher-button-widget]).
 *
 * Complements the runtime scoping that @codeblue/prime's cssScopeAttribute
 * performs (which only covers PrimeNG/CodeBlue's own runtime <style> tags).
 * This plugin scopes the rest — every selector in the widget's full-build
 * styles.css bundle, including any third-party CSS the widget imports
 * statically (Angular Material/MDC, Syncfusion tokens, fonts, etc.).
 *
 * Selector handling rules (aligned with @codeblue/prime's scopeCss):
 *   :root, :host, html, body  →  [widgetName]  (target the widget element itself)
 *   :root::before etc.        →  [widgetName]::before
 *   .foo, button, .p-x etc.   →  [widgetName] .foo  (descendant prefix)
 *   @keyframes                →  left at top level (global — not wrapped)
 *   @font-face / @property    →  left at top level (global)
 *   @media / @layer etc.      →  at-rule kept, inner rules are scoped recursively
 *
 * In addition to selector scoping, the plugin wraps all non-global top-level
 * nodes in `@layer widgets { ... }`.  Per CSS Cascade L5 §6.4.4, unlayered
 * author CSS outranks every layered rule; without this wrapper the widget's
 * full-build stylesheet would outrank `@layer app-overrides`, breaking the
 * cascade contract documented in libs/utils/docs/css-isolation.md.
 *
 * The layer name 'widgets' is the same literal exported as SSP_WIDGETS_LAYER
 * from libs/utils/src/lib/widget-config/widget-config.validator.ts.
 * No runtime cross-import is made — this file must stay zero-dependency Node JS.
 *
 * Usage:
 *   const postcss = require('postcss');
 *   const scopePlugin = require('./postcss-widget-scope-plugin');
 *   const result = postcss([scopePlugin({ widgetName: 'ssp-launcher-button-widget' })]).process(css, { from: undefined });
 */

// Layer name — same literal as SSP_WIDGETS_LAYER in widget-config.validator.ts.
// Not imported at runtime to keep this file zero-dependency Node JS.
const WIDGETS_LAYER = 'widgets';

// At-rules whose entire block must NOT be wrapped (they are inherently global).
const GLOBAL_ATRULE_NAMES = new Set([
    'keyframes',
    '-webkit-keyframes',
    '-o-keyframes',
    'font-face',
    'property',
    'charset',
    'import',
    'namespace',
    'counter-style',
    'font-feature-values',
    'font-palette-values',
    'color-profile'
]);

// Selectors that represent the document root — should target the widget element.
// `:host-context(...)` is intentionally not in this set: it always carries a
// parameterised form in real use and never matches the literal-token compare
// below. Author CSS using `:host-context` would fall through to the descendant
// branch — handle it explicitly if a widget ever needs it.
const ROOT_SELECTORS = new Set([':root', ':host', 'html', 'body']);

function isInsideGlobalAtRule(node) {
    let ancestor = node.parent;
    while (ancestor) {
        if (ancestor.type === 'atrule' && GLOBAL_ATRULE_NAMES.has(ancestor.name.toLowerCase())) {
            return true;
        }
        ancestor = ancestor.parent;
    }
    return false;
}

function rewriteSelector(selector, scopeAttr) {
    const trimmed = selector.trim();

    // Idempotency: if the selector is already scoped, leave it alone. Guards
    // against double-prefix (`[widget] [widget] .foo`) when the plugin runs
    // twice on the same file.
    if (trimmed === scopeAttr || trimmed.startsWith(`${scopeAttr} `) || trimmed.startsWith(`${scopeAttr}::`)) {
        return trimmed;
    }

    // Root selectors become the scope attribute selector itself (e.g. [ssp-launcher-button-widget])
    if (ROOT_SELECTORS.has(trimmed)) {
        return scopeAttr;
    }

    // Pseudo-elements on root selectors: 'body::before' → '[scope]::before'
    const pseudoElem = /^([\w:-]+)(::[\w-]+(?:\([^)]*\))?)$/.exec(trimmed);
    if (pseudoElem && ROOT_SELECTORS.has(pseudoElem[1])) {
        return `${scopeAttr}${pseudoElem[2]}`;
    }

    // Everything else: prefix with the scope attribute (descendant combinator)
    return `${scopeAttr} ${trimmed}`;
}

function isRootSelector(selector) {
    const trimmed = selector.trim();
    if (ROOT_SELECTORS.has(trimmed)) return true;

    const pseudoElem = /^([\w:-]+)(::[\w-]+(?:\([^)]*\))?)$/.exec(trimmed);
    return Boolean(pseudoElem && ROOT_SELECTORS.has(pseudoElem[1]));
}

function isUnsafeRootHostDeclaration(declaration) {
    if (declaration.prop.startsWith('--mat-') || declaration.prop.startsWith('--mdc-')) return true;

    return !declaration.prop.startsWith('--');
}

function targetsHostSibling(selector, scopeAttr) {
    const trimmed = selector.trim();
    const escapedScopeAttr = escapeRegExp(scopeAttr);
    const rootAlternation = Array.from(ROOT_SELECTORS).map(escapeRegExp).join('|');

    return (
        new RegExp(String.raw`^${escapedScopeAttr}\s*[+~]`).test(trimmed) ||
        new RegExp(String.raw`^(?:${rootAlternation})\s*[+~]`).test(trimmed)
    );
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function unquote(value) {
    const trimmed = value.trim();
    const quoted = /^(['"])(.*)\1$/.exec(trimmed);
    return quoted ? quoted[2] : trimmed;
}

function quoteFontFamily(value) {
    const escapedValue = value.replaceAll('"', String.raw`\"`);
    return /\s/.test(value) ? `"${escapedValue}"` : value;
}

function replaceFontFamilyReferences(value, fontFamilyMap) {
    let nextValue = value;

    for (const [original, namespaced] of fontFamilyMap) {
        const escapedOriginal = escapeRegExp(original);
        const quotedPattern = new RegExp(String.raw`(['"])${escapedOriginal}\1`, 'g');
        nextValue = nextValue.replace(quotedPattern, `$1${namespaced}$1`);

        const unquotedPattern = new RegExp(String.raw`(^|[,\s])${escapedOriginal}(?=\s*(?:,|$|!|\)))`, 'g');
        nextValue = nextValue.replace(unquotedPattern, `$1${quoteFontFamily(namespaced)}`);
    }

    return nextValue;
}

function namespaceFontFaces(root, widgetName) {
    const fontFamilyMap = new Map();

    root.walkAtRules('font-face', atRule => {
        atRule.walkDecls('font-family', declaration => {
            const original = unquote(declaration.value);
            if (!original) return;

            const namespaced = `${widgetName}__${original}`;
            fontFamilyMap.set(original, namespaced);
            declaration.value = quoteFontFamily(namespaced);
        });
    });

    if (fontFamilyMap.size === 0) return;

    root.walkDecls(declaration => {
        declaration.value = replaceFontFamilyReferences(declaration.value, fontFamilyMap);
    });
}

/**
 * Return true if `node` is a top-level `@layer widgets` block (the wrapper
 * this plugin emits).  Used for idempotency: if the root already starts with
 * one of these, the plugin must not double-wrap.
 */
function isWidgetsLayerBlock(node) {
    return node.type === 'atrule' && node.name.toLowerCase() === 'layer' && node.params.trim() === WIDGETS_LAYER;
}

function createScopePlugin(opts) {
    const { widgetName } = opts || {};
    if (!widgetName) {
        throw new Error('postcss-widget-scope: widgetName option is required');
    }
    const scopeAttr = `[${widgetName}]`;

    return {
        postcssPlugin: 'postcss-widget-scope',
        Rule(rule, { result }) {
            // Skip rules whose meaning is structural to a global at-rule (e.g. inside @keyframes)
            if (isInsideGlobalAtRule(rule)) return;

            const originalSelectors = [...rule.selectors];
            const safeSelectors = [];

            for (const selector of originalSelectors) {
                if (targetsHostSibling(selector, scopeAttr)) {
                    rule.warn(result, `Dropped host-sibling selector "${selector.trim()}" for ${scopeAttr}`);
                    continue;
                }

                safeSelectors.push(rewriteSelector(selector, scopeAttr));
            }

            if (safeSelectors.length === 0) {
                rule.remove();
                return;
            }

            rule.selectors = safeSelectors;

            if (originalSelectors.length > 0 && originalSelectors.every(isRootSelector)) {
                rule.walkDecls(declaration => {
                    if (isUnsafeRootHostDeclaration(declaration)) declaration.remove();
                });
                if (!rule.nodes || rule.nodes.length === 0) rule.remove();
            }
        },
        OnceExit(root, { AtRule }) {
            namespaceFontFaces(root, widgetName);

            // Idempotency: if the root already starts with a single @layer widgets
            // block that contains all non-global nodes, the plugin has already run
            // — do not double-wrap.
            const topNodes = root.nodes || [];
            const nonGlobalNodes = topNodes.filter(
                n => !(n.type === 'atrule' && GLOBAL_ATRULE_NAMES.has(n.name.toLowerCase()))
            );
            if (nonGlobalNodes.length === 1 && isWidgetsLayerBlock(nonGlobalNodes[0])) {
                return;
            }

            // Separate global at-rules from everything else.
            const globals = [];
            const rest = [];
            for (const node of topNodes) {
                if (node.type === 'atrule' && GLOBAL_ATRULE_NAMES.has(node.name.toLowerCase())) {
                    globals.push(node);
                } else {
                    rest.push(node);
                }
            }

            // Nothing to wrap.
            if (rest.length === 0) return;

            // Build `@layer widgets { <rest> }`.
            const layerBlock = new AtRule({ name: 'layer', params: WIDGETS_LAYER });
            rest.forEach(node => {
                node.remove();
                layerBlock.append(node);
            });

            // Remove globals from root so we can re-append in the right order.
            globals.forEach(node => node.remove());

            // Rebuild root: globals first (top of file), then the layer wrapper.
            globals.forEach(node => root.append(node));
            root.append(layerBlock);
        }
    };
}

createScopePlugin.postcss = true;
// Exported so consumer specs can assert it stays aligned with SSP_WIDGETS_LAYER
// in widget-config.validator.ts (cross-language constant drift guard).
createScopePlugin.WIDGETS_LAYER = WIDGETS_LAYER;
module.exports = createScopePlugin;
