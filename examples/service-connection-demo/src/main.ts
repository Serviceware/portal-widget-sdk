/**
 * Calls a third-party API through a Portal Service Connection (docs/sdk.md section 5a). Needs Portal 3
 * with the Service Connection proxy.
 *
 * What is saved in `customConfig` is only the connection id and a request path: public, safe.
 * The API key lives in the Service Connection on the Portal server. `ctx.service(id)` sends the
 * request to `{apiUrl}/api/v1/proxy/{connectionId}/{path}` and the Portal adds the key server-side.
 */
import {
    defineConfigSchema,
    definePortalWidget,
    ServiceConnectionNotFoundError,
    withDefaults,
    type ServiceConnection,
    type WidgetContext
} from '@serviceware-oss/portal-widget-sdk';
import styles from './styles.css';

interface DemoSettings {
    /** Id (or name) of the Service Connection linked to this widget instance. */
    connection: string;
    /** Path under the connection's base URL, query string allowed. */
    path: string;
}

const schema = defineConfigSchema<DemoSettings>({
    connection: { type: 'string', default: '' },
    path: { type: 'string', default: 'status' }
});

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

/** What the widget may know about its linked connections: names, mode and flags, never a secret. */
function describeLinkedConnections(ctx: WidgetContext<DemoSettings>): string {
    const connections = ctx.serviceConnections();
    if (connections.length === 0) {
        return 'No Service Connection is linked to this widget instance.';
    }
    return connections
        .map(
            connection =>
                `${connection.name}: ${connection.modeName}, credentials ${connection.hasCredentials ? 'held by the Portal' : 'none'}, ` +
                `anonymous ${connection.allowAnonymous ? 'allowed' : 'not allowed'}, url ${connection.url ?? '(hidden)'}`
        )
        .join('\n');
}

/** A neutral message per proxy status; the SDK hands back the Response unchanged and never retries. */
function describeFailure(response: Response): string {
    switch (response.status) {
        case 401:
            return 'Your session has expired. Sign in again.';
        case 404:
            return 'The connection is not available here (not linked, or not allowed on this page).';
        case 429:
            return `Too many requests. Try again in ${response.headers.get('Retry-After') ?? 'a few'} seconds.`;
        case 502:
        case 504:
            return 'The external service did not answer. Try again later.';
        default:
            return `The external service answered HTTP ${response.status}.`;
    }
}

function mountWidget(ctx: WidgetContext<DemoSettings>): void {
    const settings = withDefaults(ctx.inputs.configuration, schema);
    const chosen = ctx.serviceConnections().find(c => c.id === settings.connection || c.name === settings.connection);
    const output = el('pre', { className: 'output' }, 'Press "Send request".');
    const linked = el('pre', { className: 'linked' }, describeLinkedConnections(ctx));
    const button = el('button', { type: 'button', className: 'primary' }, 'Send request');

    button.addEventListener('click', async () => {
        if (!settings.connection) {
            output.textContent = 'No connection chosen yet. Open the widget settings.';
            return;
        }
        button.disabled = true;
        output.textContent = `GET ${settings.path} via "${chosen?.name ?? settings.connection}"...`;
        try {
            const response = await ctx.service(settings.connection)(settings.path, { headers: { accept: 'application/json' } });
            const body = await response.text();
            output.textContent = response.ok
                ? `HTTP ${response.status}\n${prettyJson(body)}`
                : `HTTP ${response.status}: ${describeFailure(response)}`;
        } catch (error) {
            output.textContent =
                error instanceof ServiceConnectionNotFoundError || error instanceof TypeError
                    ? error.message
                    : `Request failed: ${String(error)}`;
            ctx.toast.error(output.textContent, 'Service connection');
        } finally {
            button.disabled = false;
        }
    });

    ctx.root.append(
        el(
            'div',
            { className: 'card' },
            el('h3', {}, 'Service Connection demo'),
            el(
                'p',
                { className: 'muted' },
                `Connection: ${chosen?.name ?? (settings.connection || '(not set)')} | path: ${settings.path} | ` +
                    (ctx.inputs.authToken ? 'logged in' : 'anonymous')
            ),
            button,
            output,
            el('h4', {}, 'What this page can see'),
            linked
        )
    );
}

/**
 * Every connection of the tenant, as the Portal's own widget settings list them. Admin-only endpoint; the
 * settings view only runs for administrators. Header values arrive masked.
 */
async function loadConnections(ctx: WidgetContext<DemoSettings>): Promise<ServiceConnection[]> {
    const response = await ctx.fetch('api/v2/admin/serviceconnections');
    if (response.status === 404) {
        return [];
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as ServiceConnection[];
}

function mountSettings(ctx: WidgetContext<DemoSettings>): void {
    const settings = withDefaults(ctx.inputs.configuration, schema);

    // Values are connection ids: the id resolves right after saving, before the Portal re-sends the
    // linked connection objects.
    const select = el('select', { name: 'connection', disabled: true });
    select.append(el('option', { value: '' }, 'Loading connections...'));
    loadConnections(ctx)
        .then(connections => {
            select.replaceChildren(el('option', { value: '' }, '(choose)'));
            for (const connection of connections) {
                select.append(
                    el(
                        'option',
                        { value: connection.id, selected: connection.id === settings.connection || connection.name === settings.connection },
                        `${connection.name} (${connection.module}${connection.security?.allowAnonymous ? ', anonymous allowed' : ''})`
                    )
                );
            }
            select.disabled = false;
        })
        .catch(error => {
            select.replaceChildren(el('option', { value: '' }, `Could not load connections: ${String(error)}`));
        });
    const path = el('input', { name: 'path', value: settings.path });

    const form = el(
        'form',
        { className: 'card' },
        el('h3', {}, 'Settings'),
        el(
            'p',
            { className: 'muted' },
            'Link a Service Connection to this widget in the Portal, then choose it here. ' +
                'Store the API key in the connection, never in these settings.'
        ),
        el('label', {}, 'Service Connection', select),
        el('label', {}, 'Path', path),
        el(
            'div',
            { className: 'actions' },
            el('button', { type: 'submit', className: 'primary' }, 'Save'),
            el('button', { type: 'button', onclick: () => ctx.cancel() }, 'Cancel')
        )
    );
    form.addEventListener('submit', event => {
        event.preventDefault();
        // serviceConnectionsId is what links the connection to this instance; the proxy refuses anything else.
        ctx.save(
            { connection: select.value, path: path.value.trim() },
            { serviceConnectionsId: select.value ? [select.value] : [] }
        );
    });
    ctx.root.append(form);
}

function prettyJson(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

function mount(ctx: WidgetContext<DemoSettings>): void {
    if (ctx.inputs.settingsMode && ctx.inputs.isAdminMode) {
        mountSettings(ctx);
    } else {
        mountWidget(ctx);
    }
}

function clear(ctx: WidgetContext<DemoSettings>): void {
    for (const child of Array.from(ctx.root.childNodes)) {
        if (!(child instanceof HTMLStyleElement)) {
            child.remove();
        }
    }
}

definePortalWidget<DemoSettings>({
    tag: __WIDGET_TAG__,
    cssMode: __CSS_MODE__,
    styles,
    configSchema: schema,
    render(ctx) {
        mount(ctx);
    },
    onInputsChange(changed, ctx) {
        if ('configuration' in changed || 'settingsMode' in changed || 'isAdminMode' in changed) {
            clear(ctx);
            mount(ctx);
        }
    }
});
