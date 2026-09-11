import { defineConfigSchema } from '@serviceware/portal-widget-sdk';

/** Saved in `configuration.customConfig`; visible to every visitor of the page. */
export interface CounterSettings {
    title: string;
    /** Added per tick and per click. */
    step: number;
    /** Milliseconds between automatic ticks; 0 disables auto-ticking. */
    intervalMs: number;
    /** The counter announces a toast when it reaches this value. */
    target: number;
    accentColor: string;
    showClock: boolean;
}

export const schema = defineConfigSchema<CounterSettings>({
    title: { type: 'string', default: 'Live counter' },
    step: { type: 'number', default: 1 },
    intervalMs: { type: 'number', default: 1000 },
    target: { type: 'number', default: 60 },
    accentColor: { type: 'string', default: '#0082bb' },
    showClock: { type: 'boolean', default: true }
});

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function safeColor(value: unknown, fallback = schema.accentColor.default as string): string {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

/** Clamps whatever an admin saved (or a visitor tampered with) into values the widget can run with. */
export function sanitize(settings: CounterSettings): CounterSettings {
    const integer = (value: unknown, fallback: number, min: number, max: number): number => {
        const parsed = Math.round(Number(value));
        return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };
    return {
        title: typeof settings.title === 'string' ? settings.title.slice(0, 80) : '',
        step: integer(settings.step, 1, 1, 1000),
        intervalMs: settings.intervalMs === 0 ? 0 : integer(settings.intervalMs, 1000, 250, 60_000),
        target: integer(settings.target, 60, 1, 1_000_000),
        accentColor: safeColor(settings.accentColor),
        showClock: Boolean(settings.showClock)
    };
}
