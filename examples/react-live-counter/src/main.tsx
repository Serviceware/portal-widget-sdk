/**
 * Entry point. build.mjs bundles this (React included) into one classic script that calls
 * `customElements.define('react-live-counter', ...)` through `definePortalWidget`.
 *
 * Each element instance (the tile, and the separate instance the Portal creates inside its settings
 * dialog) gets its own React root and its own store. `ctx.root` is the element in light mode and the
 * shadow root in shadow mode; both are valid React containers.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { definePortalWidget } from '@serviceware/portal-widget-sdk';
import { App } from './App';
import { createPortalStore, PortalStoreProvider, type PortalStore } from './portal-store';
import { CounterSettings, schema } from './schema';
import styles from './styles.css';

const stores = new WeakMap<HTMLElement, PortalStore>();

definePortalWidget<CounterSettings>({
    tag: __WIDGET_TAG__,
    cssMode: __CSS_MODE__,
    styles,
    configSchema: schema,
    render(ctx) {
        const store = createPortalStore(ctx);
        stores.set(ctx.element, store);
        ctx.element.classList.add('rlc-host');

        const root = createRoot(ctx.root);
        root.render(
            <StrictMode>
                <PortalStoreProvider value={store}>
                    <App />
                </PortalStoreProvider>
            </StrictMode>
        );

        return () => {
            root.unmount();
            stores.delete(ctx.element);
            ctx.element.classList.remove('rlc-host');
        };
    },
    onInputsChange(changed, ctx) {
        stores.get(ctx.element)?.notify(changed);
    }
});
