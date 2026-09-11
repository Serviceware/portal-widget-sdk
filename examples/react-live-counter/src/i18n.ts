/**
 * Inline texts for the two languages the widget ships with. The three.js example shows the other
 * route (translation files uploaded with the widget and fetched through `ctx.loadTranslations`).
 */
const TEXTS = {
    en: {
        count: 'count',
        of: 'of',
        increment: '+{step}',
        decrement: '-{step}',
        reset: 'Reset',
        settings: 'Settings',
        paused: 'paused (hidden)',
        manual: 'manual',
        every: 'every {seconds} s',
        reached: 'Target {target} reached after {seconds} s.',
        reachedTitle: 'React Live Counter',
        changes: '{count} Portal input updates',
        lastChange: 'last: {names}',
        noChange: 'none yet',
        size: 'tile',
        adminOnly: 'Widget settings can only be changed by a Portal administrator.',
        settingsTitle: 'React Live Counter settings',
        settingsIntro: 'Everything saved here is visible to every visitor of the page.',
        title: 'Title',
        step: 'Step per tick and per click',
        intervalMs: 'Tick interval in milliseconds (0 = manual only)',
        target: 'Target value',
        accentColor: 'Accent colour',
        showClock: 'Show the clock',
        save: 'Save',
        cancel: 'Cancel',
        invalid: 'Please check the highlighted fields.'
    },
    de: {
        count: 'Zähler',
        of: 'von',
        increment: '+{step}',
        decrement: '-{step}',
        reset: 'Zurücksetzen',
        settings: 'Einstellungen',
        paused: 'pausiert (versteckt)',
        manual: 'manuell',
        every: 'alle {seconds} s',
        reached: 'Ziel {target} nach {seconds} s erreicht.',
        reachedTitle: 'React Live Counter',
        changes: '{count} Portal-Eingabe-Updates',
        lastChange: 'zuletzt: {names}',
        noChange: 'noch keine',
        size: 'Kachel',
        adminOnly: 'Widget-Einstellungen kann nur ein Portal-Administrator ändern.',
        settingsTitle: 'Einstellungen React Live Counter',
        settingsIntro: 'Alles, was hier gespeichert wird, sehen alle Besucher der Seite.',
        title: 'Titel',
        step: 'Schrittweite pro Tick und Klick',
        intervalMs: 'Tick-Intervall in Millisekunden (0 = nur manuell)',
        target: 'Zielwert',
        accentColor: 'Akzentfarbe',
        showClock: 'Uhr anzeigen',
        save: 'Speichern',
        cancel: 'Abbrechen',
        invalid: 'Bitte die markierten Felder prüfen.'
    }
} as const;

export type TextKey = keyof (typeof TEXTS)['en'];
export type Translate = (key: TextKey, params?: Record<string, string | number>) => string;

/** Picks the dictionary for a Portal language code such as `de-DE` or `en`. */
export function translator(language: string | undefined): Translate {
    const primary = (language ?? 'en').split('-')[0] as keyof typeof TEXTS;
    const texts: Record<TextKey, string> = TEXTS[primary] ?? TEXTS.en;
    return (key, params) => {
        let text = texts[key];
        for (const [name, value] of Object.entries(params ?? {})) {
            text = text.split(`{${name}}`).join(String(value));
        }
        return text;
    };
}
