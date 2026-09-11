/**
 * Bridges the SDK's imperative `onInputsChange` notification into React.
 *
 * `ctx.inputs` is a live object that is mutated in place, so React cannot detect changes on it.
 * The store takes an immutable snapshot on every notification and exposes it through
 * `useSyncExternalStore`; components that call `useInputs()` re-render exactly when the Portal
 * sets a property.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { withDefaults, type PortalWidgetInputs, type WidgetContext } from '@serviceware/portal-widget-sdk';
import { translator, type Translate } from './i18n';
import { CounterSettings, sanitize, schema } from './schema';

export interface InputsSnapshot {
    inputs: Readonly<PortalWidgetInputs<CounterSettings>>;
    /** How many `onInputsChange` batches the element has received since render. */
    changeCount: number;
    /** Input names in the most recent batch. */
    lastChanged: string[];
}

export interface PortalStore {
    readonly ctx: WidgetContext<CounterSettings>;
    subscribe(listener: () => void): () => void;
    getSnapshot(): InputsSnapshot;
    notify(changed: Partial<PortalWidgetInputs<CounterSettings>>): void;
}

export function createPortalStore(ctx: WidgetContext<CounterSettings>): PortalStore {
    const listeners = new Set<() => void>();
    let snapshot: InputsSnapshot = { inputs: { ...ctx.inputs }, changeCount: 0, lastChanged: [] };
    return {
        ctx,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot() {
            return snapshot;
        },
        notify(changed) {
            snapshot = {
                inputs: { ...ctx.inputs },
                changeCount: snapshot.changeCount + 1,
                lastChanged: Object.keys(changed)
            };
            listeners.forEach(listener => listener());
        }
    };
}

const StoreContext = createContext<PortalStore | null>(null);
export const PortalStoreProvider = StoreContext.Provider;

function useStore(): PortalStore {
    const store = useContext(StoreContext);
    if (!store) {
        throw new Error('PortalStoreProvider is missing above this component.');
    }
    return store;
}

/** The widget context: `save`, `cancel`, `openSettings`, `toast`, `onResize`, `fetch`. Stable per element. */
export function usePortal(): WidgetContext<CounterSettings> {
    return useStore().ctx;
}

/** Current Portal inputs plus change bookkeeping; re-renders the caller on every input batch. */
export function useInputs(): InputsSnapshot {
    const store = useStore();
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** `customConfig` with schema defaults applied and clamped to safe ranges. */
export function useSettings(): CounterSettings {
    const { configuration } = useInputs().inputs;
    return useMemo(() => sanitize(withDefaults(configuration, schema)), [configuration]);
}

export function useTranslate(): Translate {
    const { language } = useInputs().inputs;
    return useMemo(() => translator(language), [language]);
}
