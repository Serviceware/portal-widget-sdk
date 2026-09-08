import type { PortalWidgetInputs } from '@serviceware/portal-widget-sdk';
import type { LogoSettings } from './schema';

/** What `main.ts` keeps per element: the mounted view for the current mode (widget or settings). */
export interface MountedView {
    destroy(): void;
    onInputsChange(changed: Partial<PortalWidgetInputs<LogoSettings>>): void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

export function button(className: string, onClick: () => void): HTMLButtonElement {
    const element = h('button', className);
    element.type = 'button';
    element.addEventListener('click', onClick);
    return element;
}
