/**
 * `definePortalWidget`: the recommended way to build a widget (docs/sdk.md section 4).
 *
 * Creates a custom element with an accessor per Portal input, waits for the first
 * `configuration` before rendering, batches later input changes into one
 * `onInputsChange` call per microtask and injects styles once per tag.
 */
import { ELEMENT_INPUTS, ElementInputName, PRIVATE_WIDGET_VERSION, translationsPath, WIDGETS_CSS_LAYER } from './contract';
import { onWidgetResize, showConfiguration, toast, WidgetSize } from './events';
import { createPortalFetch } from './fetch';
import { cancelConfiguration, saveConfiguration } from './outputs';
import type { ConfigSchema, PortalWidgetInputs, WidgetConfig } from './types';

export type CssMode = 'shadow' | 'light';

export interface WidgetContext<T> {
    readonly element: HTMLElement;
    /** Where to render: the shadow root (`cssMode: 'shadow'`) or the element itself (`'light'`). */
    readonly root: ShadowRoot | HTMLElement;
    /** Live view of the inputs the Portal has set so far. */
    readonly inputs: Readonly<PortalWidgetInputs<T>>;
    /** `fetch` that adds the Portal bearer token for `apiUrl` requests only. */
    readonly fetch: typeof fetch;
    readonly toast: typeof toast;
    /** Asks the Portal to open the settings dialog for this instance. */
    openSettings(): void;
    /** Clones the current configuration with `customConfig` replaced and dispatches `configurationSaved`. */
    save(customConfig: T): void;
    cancel(): void;
    /** Portal resize events for this instance. Automatically unsubscribed on disconnect. */
    onResize(cb: (size: WidgetSize) => void): () => void;
    /** GET `storage/v1/widgets/{tag}/{version}/translations/{lang}` through `fetch`. */
    loadTranslations(lang?: string): Promise<Record<string, string>>;
}

export interface DefinePortalWidgetOptions<T> {
    tag: string;
    /** Default `'shadow'`. See docs/css-isolation.md for the trade-offs. */
    cssMode?: CssMode;
    /** CSS string. In light mode it must already be scoped to `[<tag>]` inside `@layer widgets`. */
    styles?: string;
    configSchema?: ConfigSchema<T>;
    /** Called once per connect after the first `configuration` arrived. May return a cleanup function. */
    render(ctx: WidgetContext<T>): void | (() => void);
    onInputsChange?(changed: Partial<PortalWidgetInputs<T>>, ctx: WidgetContext<T>): void;
}

const LIGHT_STYLE_ATTR = 'data-portal-widget';

function cloneConfig<T>(config: WidgetConfig<T>): WidgetConfig<T> {
    if (typeof structuredClone === 'function') {
        return structuredClone(config);
    }
    return JSON.parse(JSON.stringify(config)) as WidgetConfig<T>;
}

function injectLightStyles(tag: string, styles: string | undefined): void {
    if (document.head.querySelector(`style[${LIGHT_STYLE_ATTR}="${tag}"]`)) {
        return;
    }
    const style = document.createElement('style');
    style.setAttribute(LIGHT_STYLE_ATTR, tag);
    // The empty `[tag]` rule keeps the Portal's compliance probe satisfied even for a CSS-less widget.
    style.textContent = `/* portal-widget-css-isolation */\n@layer ${WIDGETS_CSS_LAYER} { [${tag}] {} }\n${styles ?? ''}`;
    document.head.appendChild(style);
}

function injectShadowStyles(root: ShadowRoot, styles: string | undefined): void {
    if (root.querySelector('style[data-portal-widget-shadow]')) {
        return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-portal-widget-shadow', '');
    style.textContent = `:host{display:block}:host([hidden]){display:none}\n${styles ?? ''}`;
    root.appendChild(style);
}

export function definePortalWidget<T = Record<string, unknown>>(options: DefinePortalWidgetOptions<T>): void {
    const { tag, styles, configSchema, render, onInputsChange } = options;
    const cssMode: CssMode = options.cssMode ?? 'shadow';

    class PortalWidgetElement extends HTMLElement {
        private readonly _inputs = {} as PortalWidgetInputs<T>;
        private _pending: Partial<PortalWidgetInputs<T>> | null = null;
        private _flushQueued = false;
        private _renderQueued = false;
        private _rendered = false;
        private _cleanup: (() => void) | void = undefined;
        private _unsubscribers: (() => void)[] = [];
        private _root: ShadowRoot | HTMLElement | null = null;
        private _ctx: WidgetContext<T> | null = null;

        connectedCallback(): void {
            this._scheduleRender();
        }

        disconnectedCallback(): void {
            this._teardown();
        }

        /** Called by every generated input accessor. */
        _setInput(name: ElementInputName, value: unknown): void {
            (this._inputs as unknown as Record<string, unknown>)[name] = value;
            if (name === 'hidden') {
                this.toggleAttribute('hidden', Boolean(value));
            }
            if (!this._rendered) {
                this._scheduleRender();
                return;
            }
            this._pending = { ...(this._pending ?? {}), [name]: value } as Partial<PortalWidgetInputs<T>>;
            if (!this._flushQueued) {
                this._flushQueued = true;
                queueMicrotask(() => this._flush());
            }
        }

        _getInput(name: ElementInputName): unknown {
            return (this._inputs as unknown as Record<string, unknown>)[name];
        }

        private _scheduleRender(): void {
            if (this._renderQueued || this._rendered) {
                return;
            }
            this._renderQueued = true;
            queueMicrotask(() => this._render());
        }

        private _render(): void {
            this._renderQueued = false;
            if (this._rendered || !this.isConnected || this._inputs.configuration === undefined) {
                return;
            }

            if (cssMode === 'shadow') {
                const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
                injectShadowStyles(shadow, styles);
                this._root = shadow;
            } else {
                injectLightStyles(tag, styles);
                this._root = this;
            }

            this._ctx = this._createContext(this._root);
            this._rendered = true;
            this._cleanup = render(this._ctx);
        }

        private _flush(): void {
            this._flushQueued = false;
            const changed = this._pending;
            this._pending = null;
            if (changed && this._rendered && this._ctx && onInputsChange) {
                onInputsChange(changed, this._ctx);
            }
        }

        private _teardown(): void {
            for (const unsubscribe of this._unsubscribers.splice(0)) {
                unsubscribe();
            }
            if (typeof this._cleanup === 'function') {
                this._cleanup();
            }
            this._cleanup = undefined;
            this._pending = null;
            this._flushQueued = false;
            if (this._root) {
                for (const child of Array.from(this._root.childNodes)) {
                    if (!(child instanceof HTMLStyleElement && child.hasAttribute('data-portal-widget-shadow'))) {
                        child.remove();
                    }
                }
            }
            this._rendered = false;
            this._ctx = null;
        }

        private _createContext(root: ShadowRoot | HTMLElement): WidgetContext<T> {
            const inputs = this._inputs;
            const portalFetch = createPortalFetch(() => ({
                apiUrl: inputs.apiUrl ?? '',
                authToken: inputs.authToken ?? ''
            }));

            return {
                element: this,
                root,
                inputs,
                fetch: portalFetch,
                toast,
                openSettings: (): void => {
                    showConfiguration(inputs.configuration);
                },
                save: (customConfig: T): void => {
                    const next = cloneConfig(inputs.configuration);
                    next.customConfig = customConfig;
                    saveConfiguration(this, next, configSchema);
                },
                cancel: (): void => {
                    cancelConfiguration(this);
                },
                onResize: (cb: (size: WidgetSize) => void): (() => void) => {
                    const unsubscribe = onWidgetResize(inputs.configuration.id, cb);
                    this._unsubscribers.push(unsubscribe);
                    return () => {
                        unsubscribe();
                        this._unsubscribers = this._unsubscribers.filter(u => u !== unsubscribe);
                    };
                },
                loadTranslations: async (lang?: string): Promise<Record<string, string>> => {
                    const language = lang ?? inputs.language;
                    if (!language) {
                        throw new Error('loadTranslations: no language given and the Portal has not set one yet.');
                    }
                    const version = inputs.configuration.usedVersion?.number || PRIVATE_WIDGET_VERSION;
                    const response = await portalFetch(translationsPath(tag, version, language));
                    if (!response.ok) {
                        throw new Error(`loadTranslations: HTTP ${response.status} for language "${language}".`);
                    }
                    return (await response.json()) as Record<string, string>;
                }
            };
        }
    }

    for (const name of ELEMENT_INPUTS) {
        Object.defineProperty(PortalWidgetElement.prototype, name, {
            configurable: true,
            enumerable: true,
            get(this: PortalWidgetElement) {
                return this._getInput(name);
            },
            set(this: PortalWidgetElement, value: unknown) {
                this._setInput(name, value);
            }
        });
    }

    customElements.define(tag, PortalWidgetElement);
}
