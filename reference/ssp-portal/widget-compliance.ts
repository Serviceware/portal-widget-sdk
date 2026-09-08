import { SSP_WIDGETS_LAYER, trackWidgetComplianceViolation } from '@ssp/utils';

const DETECTION_DELAY_MS = 1500;

/**
 * Runs the runtime widget-compliance check against Portal's CSS-isolation contract.
 *
 * Three detections, one synchronous and two deferred. See `libs/utils/docs/css-isolation.md`
 * for the contract widgets opt into.
 *
 * Async detections run after `DETECTION_DELAY_MS` to give the lazy element time
 * to load and `@codeblue/prime`'s runtime style injection time to settle. Widgets
 * slower than that surface as false negatives; we accept that — the per-session
 * throttle on `trackWidgetComplianceViolation` keeps the noise bounded.
 */
export function checkWidgetCompliance(host: HTMLElement, widgetTag: string, widgetVersion?: string): void {
    if (!host.hasAttribute(widgetTag)) {
        trackWidgetComplianceViolation(widgetTag, 'host_attribute_mismatch', widgetVersion);
        return;
    }

    setTimeout(() => {
        const probe = probeStylesheetsForWidgetScope(widgetTag);
        if (!probe.hasScopedRule) {
            trackWidgetComplianceViolation(widgetTag, 'missing_css_scope_attribute', widgetVersion);
        } else if (!probe.inWidgetsLayer) {
            trackWidgetComplianceViolation(widgetTag, 'css_layer_mismatch', widgetVersion);
        }
    }, DETECTION_DELAY_MS);
}

/**
 * Walks `document.styleSheets` looking for a rule whose selector references
 * `[widgetTag]`, and tracks whether that rule lives inside `@layer widgets`.
 * Cross-origin sheets are skipped silently (their `cssRules` accessor throws).
 *
 * Exported for unit testing — the entry-point function above is the runtime API.
 */
export function probeStylesheetsForWidgetScope(widgetTag: string): {
    hasScopedRule: boolean;
    inWidgetsLayer: boolean;
} {
    const tagSelector = `[${widgetTag}]`;
    let hasScopedRule = false;
    let inWidgetsLayer = false;

    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        const result = scanCssRules(rules, tagSelector, false);
        if (result.hasScopedRule) hasScopedRule = true;
        if (result.inWidgetsLayer) inWidgetsLayer = true;
        if (hasScopedRule && inWidgetsLayer) break;
    }

    return { hasScopedRule, inWidgetsLayer };
}

function scanCssRules(
    rules: CSSRuleList,
    tagSelector: string,
    insideWidgetsLayer: boolean
): { hasScopedRule: boolean; inWidgetsLayer: boolean } {
    let hasScopedRule = false;
    let inWidgetsLayer = false;
    const layerCtor = (globalThis as unknown as { CSSLayerBlockRule?: new () => CSSRule }).CSSLayerBlockRule;

    for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(tagSelector)) {
            hasScopedRule = true;
            if (insideWidgetsLayer) inWidgetsLayer = true;
        }
        if (layerCtor && rule instanceof layerCtor) {
            const layerRule = rule as CSSRule & { name: string; cssRules: CSSRuleList };
            const childInsideWidgets = insideWidgetsLayer || layerRule.name === SSP_WIDGETS_LAYER;
            const sub = scanCssRules(layerRule.cssRules, tagSelector, childInsideWidgets);
            if (sub.hasScopedRule) hasScopedRule = true;
            if (sub.inWidgetsLayer) inWidgetsLayer = true;
        }
    }

    return { hasScopedRule, inWidgetsLayer };
}
