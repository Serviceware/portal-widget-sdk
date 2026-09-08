/**
 * Widget -> Portal commands and the Portal -> widget resize subscription.
 * Every command dispatches exactly one `CustomEvent` on `window`; payload shapes
 * are fixed by docs/contract.md section 4.
 */
import { PORTAL_EVENTS, PortalEventName, portalEventType, TOAST_DEFAULT_LIFE } from './contract';
import type { ResizeEventArgs, SkeletonScheme, ToastOptions, WidgetConfig } from './types';

function dispatch(name: PortalEventName, args: Record<string, unknown>): void {
    window.dispatchEvent(new CustomEvent(portalEventType(name), { detail: { ...args, handled: false } }));
}

export function showToast(options: ToastOptions): void {
    dispatch(PORTAL_EVENTS.showToast, { message: options });
}

function quickToast(severity: ToastOptions['severity'], detail: string, summary: string | undefined): void {
    const options: ToastOptions = { severity, detail, life: TOAST_DEFAULT_LIFE[severity] };
    if (severity === 'error') {
        options.sticky = true;
    }
    if (summary !== undefined) {
        options.summary = summary;
    }
    showToast(options);
}

/** Toast shortcuts with the lifetimes the Portal's own widgets use. */
export const toast = {
    success(detail: string, summary?: string): void {
        quickToast('success', detail, summary);
    },
    info(detail: string, summary?: string): void {
        quickToast('info', detail, summary);
    },
    warning(detail: string, summary?: string): void {
        quickToast('warn', detail, summary);
    },
    error(detail: string, summary?: string): void {
        quickToast('error', detail, summary);
    }
};

/** Opens the Portal settings dialog for the widget instance described by `config`. */
export function showConfiguration<T>(config: WidgetConfig<T>): void {
    dispatch(PORTAL_EVENTS.showConfigModal, { ...config });
}

export function navigate(route: string, queryParams?: Record<string, string>): void {
    dispatch(PORTAL_EVENTS.navigateRoute, queryParams === undefined ? { route } : { route, queryParams });
}

export function showSkeleton(widgetId: string, scheme?: SkeletonScheme): void {
    dispatch(PORTAL_EVENTS.loadWidgetSkeleton, { widgetId, scheme, errorMessageAdmin: '', errorMessageUser: '' });
}

export function hideSkeleton(widgetId: string): void {
    dispatch(PORTAL_EVENTS.stopWidgetSkeleton, { widgetId });
}

export interface WidgetSize {
    width: number;
    height: number;
}

/** Subscribes to Portal resize events for one widget instance. Returns the unsubscribe function. */
export function onWidgetResize(widgetId: string, cb: (size: WidgetSize) => void): () => void {
    const type = portalEventType(PORTAL_EVENTS.widgetResized);
    const listener = (event: Event): void => {
        const detail = (event as CustomEvent<Partial<ResizeEventArgs>>).detail;
        if (detail && detail.widgetId === widgetId) {
            cb({ width: Number(detail.newWidth), height: Number(detail.newHeight) });
        }
    };
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
}
