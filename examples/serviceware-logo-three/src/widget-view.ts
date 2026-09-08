import {
    debugConfig,
    hideSkeleton,
    navigate,
    showSkeleton,
    withDefaults,
    type PortalWidgetInputs,
    type WidgetContext
} from '@serviceware/portal-widget-sdk';
import { button, h, type MountedView } from './dom';
import { pickOverrides, Translator } from './i18n';
import { LogoScene } from './scene';
import { LogoSettings, schema } from './schema';

/** The widget proper: 3D stage, caption, a toolbar that fires every SDK command, and an inputs panel. */
export function mountWidget(ctx: WidgetContext<LogoSettings>): MountedView {
    const inputs = ctx.inputs;
    const texts = new Translator();
    let settings = withDefaults(inputs.configuration, schema);
    let lastResize = '';
    let skeletonTimer: ReturnType<typeof setTimeout> | undefined;
    let toastIndex = 0;

    ctx.element.classList.add('sw3d-host');

    const root = h('div', 'sw3d-root');
    const stage = h('div', 'sw3d-stage');
    const caption = h('div', 'sw3d-caption');
    const toolbar = h('div', 'sw3d-toolbar');
    const panel = h('details', 'sw3d-panel');
    const summary = h('summary');
    const rows = h('dl');
    panel.append(summary, rows);
    root.append(stage, caption, toolbar, panel);
    ctx.root.appendChild(root);

    let scene: LogoScene | null = null;
    try {
        scene = new LogoScene(stage, settings);
    } catch (error) {
        console.warn(`[${__WIDGET_TAG__}] WebGL unavailable`, error);
        stage.classList.add('sw3d-stage-fallback');
    }

    const severities = ['success', 'info', 'warning', 'error'] as const;
    const toastButton = button('sw3d-button', () => {
        const severity = severities[toastIndex % severities.length] as (typeof severities)[number];
        toastIndex += 1;
        ctx.toast[severity](texts.t(`toast.${severity}`, { frames: scene?.frames ?? 0 }), texts.t('toast.title'));
    });
    const settingsButton = button('sw3d-button sw3d-button-primary', () => ctx.openSettings());
    const navigateButton = button('sw3d-button', () => navigate('/home'));
    const skeletonButton = button('sw3d-button', () => {
        const widgetId = inputs.configuration.id;
        showSkeleton(widgetId);
        clearTimeout(skeletonTimer);
        skeletonTimer = setTimeout(() => hideSkeleton(widgetId), 2000);
    });
    const translationsButton = button('sw3d-button', () => void loadTexts(true));
    const debugButton = button('sw3d-button', () => {
        console.info(`[${__WIDGET_TAG__}] configuration`, debugConfig(inputs.configuration, schema));
        ctx.toast.info(texts.t('toast.debugLogged'), texts.t('toast.title'));
    });
    toolbar.append(toastButton, settingsButton, navigateButton, skeletonButton, translationsButton, debugButton);

    const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                scene?.resize(width, height);
            }
        }
    });
    resizeObserver.observe(stage);

    const stopResize = ctx.onResize(size => {
        lastResize = `${Math.round(size.width)} x ${Math.round(size.height)} px`;
        refreshPanel();
    });

    const panelTimer = setInterval(() => {
        if (panel.open) {
            refreshPanel();
        }
    }, 1000);

    async function loadTexts(announce: boolean): Promise<void> {
        const language = inputs.language || 'en';
        const overrides = pickOverrides(inputs.configuration.customTrans, language);
        if (!inputs.apiUrl) {
            texts.set(undefined, overrides);
            refreshTexts();
            return;
        }
        try {
            const loaded = await ctx.loadTranslations(language);
            texts.set(loaded, overrides);
            refreshTexts();
            if (announce) {
                ctx.toast.success(
                    texts.t('toast.translationsLoaded', { count: Object.keys(loaded).length, language }),
                    texts.t('toast.title')
                );
            }
        } catch (error) {
            texts.set(undefined, overrides);
            refreshTexts();
            if (announce) {
                ctx.toast.warning(texts.t('toast.translationsFailed', { error: (error as Error).message }), texts.t('toast.title'));
            }
        }
    }

    function refreshTexts(): void {
        toastButton.textContent = texts.t('toolbar.toast');
        settingsButton.textContent = texts.t('toolbar.settings');
        navigateButton.textContent = texts.t('toolbar.navigate');
        skeletonButton.textContent = texts.t('toolbar.skeleton');
        translationsButton.textContent = texts.t('toolbar.translations');
        debugButton.textContent = texts.t('toolbar.debug');
        summary.textContent = texts.t('panel.title');
        caption.textContent = settings.caption;
        caption.hidden = !settings.caption;
        if (!scene) {
            stage.textContent = texts.t('stage.noWebgl');
        }
        refreshPanel();
    }

    function refreshPanel(): void {
        const yesNo = (value: unknown): string => String(Boolean(value));
        let apiHost = texts.t('panel.empty');
        try {
            apiHost = inputs.apiUrl ? new URL(inputs.apiUrl).host : apiHost;
        } catch {
            apiHost = inputs.apiUrl;
        }
        const entries: [string, string][] = [
            ['panel.language', inputs.language ?? texts.t('panel.empty')],
            ['panel.layout', inputs.portalScreenLayout ?? texts.t('panel.empty')],
            ['panel.adminMode', yesNo(inputs.isAdminMode)],
            ['panel.editionMode', yesNo(inputs.portalEditionMode)],
            ['panel.settingsMode', yesNo(inputs.settingsMode)],
            ['panel.showSettingsButton', yesNo(inputs.showSettingsButton)],
            ['panel.hidden', yesNo(inputs.hidden)],
            ['panel.apiUrl', apiHost],
            ['panel.authToken', inputs.authToken ? texts.t('panel.present') : texts.t('panel.empty')],
            ['panel.userProfile', inputs.configuration.userProfile ? texts.t('panel.present') : texts.t('panel.anonymous')],
            // Names only. `security.headers` must never reach the UI or the console (docs/security.md).
            [
                'panel.serviceConnections',
                (inputs.configuration.serviceConnections ?? []).map(connection => connection.name).join(', ') || texts.t('panel.none')
            ],
            ['panel.resize', lastResize || texts.t('panel.none')],
            ['panel.frames', String(scene?.frames ?? 0)]
        ];
        rows.replaceChildren(...entries.flatMap(([key, value]) => [h('dt', undefined, texts.t(key)), h('dd', undefined, value)]));
    }

    settingsButton.hidden = !inputs.showSettingsButton;
    refreshTexts();
    void loadTexts(false);
    if (inputs.hidden) {
        scene?.stop();
    } else {
        scene?.start();
    }

    return {
        onInputsChange(changed: Partial<PortalWidgetInputs<LogoSettings>>): void {
            if ('configuration' in changed) {
                settings = withDefaults(inputs.configuration, schema);
                scene?.applySettings(settings);
                void loadTexts(false);
            } else if ('language' in changed) {
                void loadTexts(false);
            }
            if ('hidden' in changed) {
                if (changed.hidden) {
                    scene?.stop();
                } else {
                    scene?.start();
                }
            }
            if ('showSettingsButton' in changed) {
                settingsButton.hidden = !changed.showSettingsButton;
            }
            refreshTexts();
        },
        destroy(): void {
            clearTimeout(skeletonTimer);
            clearInterval(panelTimer);
            resizeObserver.disconnect();
            stopResize();
            scene?.dispose();
            root.remove();
            ctx.element.classList.remove('sw3d-host');
        }
    };
}
