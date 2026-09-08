import { defineConfigSchema } from '@serviceware/portal-widget-sdk';
import { ICON_FILL } from './logo-svg';

/** Saved in `configuration.customConfig`; visible to every visitor of the page. */
export interface LogoSettings {
    iconColor: string;
    depth: number;
    rotationSpeed: number;
    autoRotate: boolean;
    wireframe: boolean;
    caption: string;
    /** Exists only to demonstrate the SDK's secret guard; saving a non-empty value throws. */
    apiKey: string;
}

export const schema = defineConfigSchema<LogoSettings>({
    iconColor: { type: 'string', default: ICON_FILL },
    /** In model units; the icon's larger side is 100. */
    depth: { type: 'number', default: 12 },
    rotationSpeed: { type: 'number', default: 0.5 },
    autoRotate: { type: 'boolean', default: true },
    wireframe: { type: 'boolean', default: false },
    caption: { type: 'string', default: '' },
    apiKey: { type: 'string', secret: true, default: '' }
});

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Returns a safe `#rrggbb` string; anything else falls back to the schema default. */
export function safeColor(value: unknown, fallback = ICON_FILL): string {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}
