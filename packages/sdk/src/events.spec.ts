import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideSkeleton, navigate, onWidgetResize, showConfiguration, showSkeleton, showToast, toast } from './events';
import type { WidgetConfig } from './types';

function captureWindowEvents(): CustomEvent[] {
    const captured: CustomEvent[] = [];
    const original = window.dispatchEvent.bind(window);
    vi.spyOn(window, 'dispatchEvent').mockImplementation(event => {
        captured.push(event as CustomEvent);
        return original(event);
    });
    return captured;
}

const config: WidgetConfig<{ greeting: string }> = {
    id: 'rw-1',
    routeId: 7,
    customConfig: { greeting: 'hi' },
    meta: [{ language: 'en', name: 'Test' }],
    usedVersion: {
        id: 'v1',
        name: 'acme-test',
        number: '1.0.0',
        authenticated: false,
        angularVersion: 0,
        fileName: 'acme-test-1.0.0-full.js',
        fileNameLight: 'acme-test-1.0.0-light.js'
    },
    position: { desktop: { x: 0, y: 0, columns: 2, rows: 1 } },
    userProfile: null
};

afterEach(() => vi.restoreAllMocks());

describe('window commands', () => {
    it('showToast dispatches exactly one eventShowToastSSPEvent wrapping the options in message', () => {
        const events = captureWindowEvents();
        showToast({ severity: 'info', detail: 'Body', summary: 'Title', life: 1234 });
        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe('eventShowToastSSPEvent');
        expect(events[0]!.detail).toEqual({
            message: { severity: 'info', detail: 'Body', summary: 'Title', life: 1234 },
            handled: false
        });
    });

    it('toast shortcuts use the Portal default lifetimes and error is sticky', () => {
        const events = captureWindowEvents();
        toast.success('ok');
        toast.info('fyi', 'Info');
        toast.warning('careful');
        toast.error('boom');
        expect(events.map(e => e.detail)).toEqual([
            { message: { severity: 'success', detail: 'ok', life: 5000 }, handled: false },
            { message: { severity: 'info', detail: 'fyi', summary: 'Info', life: 5000 }, handled: false },
            { message: { severity: 'warn', detail: 'careful', life: 4000 }, handled: false },
            { message: { severity: 'error', detail: 'boom', life: 0, sticky: true }, handled: false }
        ]);
    });

    it('showConfiguration spreads the config into detail and adds handled', () => {
        const events = captureWindowEvents();
        showConfiguration(config);
        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe('eventShowConfigModalSSPEvent');
        expect(events[0]!.detail).toEqual({ ...config, handled: false });
    });

    it('navigate carries route and optional queryParams', () => {
        const events = captureWindowEvents();
        navigate('/home');
        navigate('/search', { q: 'printer' });
        expect(events.map(e => e.type)).toEqual(['eventNavigateRouteSSPEvent', 'eventNavigateRouteSSPEvent']);
        expect(events[0]!.detail).toEqual({ route: '/home', handled: false });
        expect(events[1]!.detail).toEqual({ route: '/search', queryParams: { q: 'printer' }, handled: false });
    });

    it('skeleton commands match the contract payloads', () => {
        const events = captureWindowEvents();
        showSkeleton('rw-1');
        showSkeleton('rw-1', { rows: 3 });
        hideSkeleton('rw-1');
        expect(events.map(e => e.type)).toEqual([
            'eventLoadWidgetSkeletonSSPEvent',
            'eventLoadWidgetSkeletonSSPEvent',
            'eventStopWidgetSkeletonSSPEvent'
        ]);
        expect(events[0]!.detail).toEqual({
            widgetId: 'rw-1',
            scheme: undefined,
            errorMessageAdmin: '',
            errorMessageUser: '',
            handled: false
        });
        expect(events[1]!.detail.scheme).toEqual({ rows: 3 });
        expect(events[2]!.detail).toEqual({ widgetId: 'rw-1', handled: false });
    });
});

describe('onWidgetResize', () => {
    it('forwards only events for the given widgetId and unsubscribes', () => {
        const sizes: unknown[] = [];
        const unsubscribe = onWidgetResize('rw-1', size => sizes.push(size));

        window.dispatchEvent(
            new CustomEvent('eventWidgetResizedSSPEvent', { detail: { widgetId: 'rw-2', newWidth: 1, newHeight: 1 } })
        );
        window.dispatchEvent(
            new CustomEvent('eventWidgetResizedSSPEvent', { detail: { widgetId: 'rw-1', newWidth: 640, newHeight: 320 } })
        );
        expect(sizes).toEqual([{ width: 640, height: 320 }]);

        unsubscribe();
        window.dispatchEvent(
            new CustomEvent('eventWidgetResizedSSPEvent', { detail: { widgetId: 'rw-1', newWidth: 1, newHeight: 1 } })
        );
        expect(sizes).toHaveLength(1);
    });
});
