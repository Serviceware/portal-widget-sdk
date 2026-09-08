/**
 * Entry point. build.mjs bundles this into a single classic script that calls
 * `customElements.define('serviceware-logo-three', ...)` through `definePortalWidget`.
 */
import { definePortalWidget, type WidgetContext } from '@serviceware/portal-widget-sdk';
import type { MountedView } from './dom';
import { LogoSettings, schema } from './schema';
import { mountAdminOnlyNotice, mountSettings } from './settings-view';
import styles from './styles.css';
import { mountWidget } from './widget-view';

const views = new WeakMap<HTMLElement, MountedView>();

/**
 * The Portal renders a widget with `settingsMode` only inside the administrator's settings dialog, and
 * sets `showSettingsButton` only for administrators. The extra `isAdminMode` check is belt and braces:
 * a settings-mode instance that is not in admin mode gets a notice instead of the form.
 */
function mount(ctx: WidgetContext<LogoSettings>): void {
    const { settingsMode, isAdminMode } = ctx.inputs;
    if (!settingsMode) {
        views.set(ctx.element, mountWidget(ctx));
        return;
    }
    views.set(ctx.element, isAdminMode ? mountSettings(ctx) : mountAdminOnlyNotice(ctx));
}

function unmount(ctx: WidgetContext<LogoSettings>): void {
    views.get(ctx.element)?.destroy();
    views.delete(ctx.element);
}

definePortalWidget<LogoSettings>({
    tag: __WIDGET_TAG__,
    cssMode: __CSS_MODE__,
    styles,
    configSchema: schema,
    render(ctx) {
        mount(ctx);
        return () => unmount(ctx);
    },
    onInputsChange(changed, ctx) {
        // The Portal never flips settingsMode on a live element, but the harness does; swap the whole view.
        if ('settingsMode' in changed || ('isAdminMode' in changed && ctx.inputs.settingsMode)) {
            unmount(ctx);
            mount(ctx);
            return;
        }
        views.get(ctx.element)?.onInputsChange(changed);
    }
});
