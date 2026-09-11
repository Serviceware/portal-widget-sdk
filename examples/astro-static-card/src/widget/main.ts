/**
 * Runtime of the widget: the only JavaScript that ships besides the SDK. It mounts the HTML Astro
 * rendered at build time, picks the language variant, shows the settings button when the Portal asks
 * for it, and forwards a few clicks to the Portal (router navigation, closing the settings dialog).
 */
import { definePortalWidget, navigate, type WidgetContext } from '@serviceware/portal-widget-sdk';
import pages from 'virtual:astro-pages';
import styles from 'virtual:astro-styles';

type Settings = Record<string, never>;

/** Exact code, then primary subtag (`de-DE` -> `de`), then `en`, then whatever was rendered first. */
function pickLanguage(language: string | undefined): string {
    const candidates = [language, language?.split('-')[0], 'en', pages.languages[0]];
    return candidates.find((code): code is string => Boolean(code && pages.widget[code])) ?? 'en';
}

function paint(ctx: WidgetContext<Settings>): void {
    const lang = pickLanguage(ctx.inputs.language);
    const html = ctx.inputs.settingsMode ? pages.settings[lang] : pages.widget[lang];
    ctx.root.innerHTML = html ?? '';
    ctx.element.lang = lang;
    const generator = ctx.root.querySelector('[data-generator]');
    if (generator) {
        generator.textContent = pages.generator;
    }
    syncSettingsButton(ctx);
}

function syncSettingsButton(ctx: WidgetContext<Settings>): void {
    const button = ctx.root.querySelector<HTMLButtonElement>('[data-action="settings"]');
    if (button) {
        button.hidden = !ctx.inputs.showSettingsButton;
    }
}

function handleClick(ctx: WidgetContext<Settings>, event: Event): void {
    const target = event.target as Element | null;
    const action = target?.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'settings') {
        ctx.openSettings();
        return;
    }
    if (action === 'cancel') {
        ctx.cancel();
        return;
    }
    const link = target?.closest<HTMLAnchorElement>('a[data-route]');
    if (link?.dataset.route) {
        event.preventDefault();
        const query = link.dataset.query ? (JSON.parse(link.dataset.query) as Record<string, string>) : undefined;
        navigate(link.dataset.route, query);
    }
}

definePortalWidget<Settings>({
    tag: __WIDGET_TAG__,
    cssMode: __CSS_MODE__,
    styles,
    render(ctx) {
        ctx.element.classList.add('asc-host');
        paint(ctx);
        const onClick = (event: Event): void => handleClick(ctx, event);
        ctx.root.addEventListener('click', onClick);
        return () => {
            ctx.root.removeEventListener('click', onClick);
            ctx.element.classList.remove('asc-host');
        };
    },
    onInputsChange(changed, ctx) {
        if ('language' in changed || 'settingsMode' in changed) {
            paint(ctx);
        } else if ('showSettingsButton' in changed) {
            syncSettingsButton(ctx);
        }
    }
});
