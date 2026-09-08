import type { LanguageTranslations } from '@serviceware/portal-widget-sdk';

export type Texts = Record<string, string>;

/** English defaults, used until the Portal translations arrive and for keys they do not cover. */
export const FALLBACK_TEXTS: Texts = {
    'toolbar.toast': 'Toast',
    'toolbar.settings': 'Settings',
    'toolbar.navigate': 'Go to /home',
    'toolbar.skeleton': 'Skeleton (2 s)',
    'toolbar.translations': 'Reload texts',
    'toolbar.debug': 'Log config',
    'toast.title': 'Serviceware Logo 3D',
    'toast.success': 'Success toast from the widget. {frames} frames rendered so far.',
    'toast.info': 'Info toast from the widget.',
    'toast.warning': 'Warning toast from the widget.',
    'toast.error': 'Error toast from the widget. It stays until closed.',
    'toast.translationsLoaded': 'Loaded {count} texts for "{language}".',
    'toast.translationsFailed': 'Could not load texts: {error}',
    'toast.debugLogged': 'Redacted configuration written to the browser console.',
    'panel.title': 'Portal inputs',
    'panel.language': 'language',
    'panel.layout': 'screen layout',
    'panel.adminMode': 'admin mode',
    'panel.editionMode': 'edition mode',
    'panel.settingsMode': 'settings mode',
    'panel.showSettingsButton': 'show settings button',
    'panel.hidden': 'hidden',
    'panel.apiUrl': 'API host',
    'panel.authToken': 'auth token',
    'panel.userProfile': 'user profile',
    'panel.serviceConnections': 'service connections',
    'panel.resize': 'last Portal resize',
    'panel.frames': 'frames rendered',
    'panel.none': 'none yet',
    'panel.present': 'present (not shown)',
    'panel.empty': 'empty',
    'panel.anonymous': 'anonymous',
    'stage.noWebgl': 'WebGL is not available in this browser.',
    'settings.title': 'Serviceware Logo 3D',
    'settings.intro': 'Everything saved here is visible to every visitor of the page.',
    'settings.iconColor': 'Icon colour',
    'settings.depth': 'Extrusion depth',
    'settings.rotationSpeed': 'Rotation speed (radians per second)',
    'settings.autoRotate': 'Rotate automatically',
    'settings.wireframe': 'Wireframe',
    'settings.caption': 'Caption under the logo',
    'settings.apiKey': 'API key (secret field)',
    'settings.apiKeyHint': 'Marked secret in the config schema: the SDK refuses to save a non-empty value.',
    'settings.save': 'Save',
    'settings.cancel': 'Cancel',
    'settings.adminOnly': 'Widget settings can only be changed by a Portal administrator.'
};

/** `customTrans` overrides for a language, trying the exact code and then its primary subtag. */
export function pickOverrides(customTrans: LanguageTranslations | undefined, language: string): Texts | undefined {
    if (!customTrans) {
        return undefined;
    }
    return customTrans[language] ?? customTrans[language.split('-')[0] ?? language];
}

export class Translator {
    private texts: Texts = { ...FALLBACK_TEXTS };

    /** Fallback < Portal translation file < admin overrides from `customTrans`. */
    set(loaded: Texts | undefined, overrides: Texts | undefined): void {
        this.texts = { ...FALLBACK_TEXTS, ...(loaded ?? {}), ...(overrides ?? {}) };
    }

    t(key: string, params?: Record<string, string | number>): string {
        let text = this.texts[key] ?? key;
        if (params) {
            for (const [name, value] of Object.entries(params)) {
                text = text.split(`{${name}}`).join(String(value));
            }
        }
        return text;
    }
}
