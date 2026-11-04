/**
 * Test widget for one Service Connection security mode (the build injects it as __AUTH_MODE__). It calls the
 * linked connection through the real Portal proxy and shows whether the test API (upstream.mjs) accepted the
 * credential the Portal added. The widget never sees that credential: `customConfig` holds only the
 * connection id, and the proxy adds the credential server-side.
 */
import {
    defineConfigSchema,
    definePortalWidget,
    ServiceConnectionNotFoundError,
    withDefaults,
    type ServiceConnection,
    type ServiceConnectionInfo,
    type WidgetContext
} from '@serviceware-oss/portal-widget-sdk';
import styles from './styles.css';

interface TestSettings {
    /** Id of the Service Connection linked to this widget instance. */
    connection: string;
}

/** What upstream.mjs answers. Names only: the test API never echoes a value. */
interface UpstreamVerdict {
    mode: string;
    accepted: boolean;
    reason: string;
    method: string;
    path: string;
    queryNames: string[];
    headerNames: string[];
    portalTokenReachedUpstream: boolean;
    user?: { name?: string; issuer?: string; expiresAt?: string };
}

const schema = defineConfigSchema<TestSettings>({
    connection: { type: 'string', default: '' }
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

function setVerdict(target: HTMLParagraphElement, kind: 'pass' | 'fail' | 'idle', text: string): void {
    target.className = `verdict ${kind}`;
    target.textContent = text;
}

function describeConnection(connection: ServiceConnectionInfo | undefined): string {
    if (!connection) {
        return 'No connection linked yet: open the widget settings and choose one.';
    }
    return (
        `${connection.name}: mode ${connection.modeName}, credentials ${connection.hasCredentials ? 'held by the Portal' : 'none'}, ` +
        `anonymous ${connection.allowAnonymous ? 'allowed' : 'not allowed'}`
    );
}

/** PASS only when the mode matches, the test API accepted the credential and no Portal token leaked. */
function judge(verdict: UpstreamVerdict): { pass: boolean; text: string } {
    if (verdict.mode !== __AUTH_MODE__) {
        return { pass: false, text: `FAIL: the connection points to the ${verdict.mode} endpoint, expected ${__AUTH_MODE__}.` };
    }
    if (!verdict.accepted) {
        return { pass: false, text: `FAIL: the test API refused the request: ${verdict.reason}` };
    }
    if (__AUTH_MODE__ !== 'ForwardUserToken' && verdict.portalTokenReachedUpstream) {
        return { pass: false, text: 'FAIL: the caller\'s Portal token reached the upstream; the proxy must drop it.' };
    }
    return { pass: true, text: `PASS: ${verdict.reason}` };
}

function mountWidget(ctx: WidgetContext<TestSettings>): void {
    const settings = withDefaults(ctx.inputs.configuration, schema);
    const connection = ctx.serviceConnections().find(c => c.id === settings.connection || c.name === settings.connection);
    const verdict = el('p', { className: 'verdict idle' }, 'Press "Run test".');
    const details = el('pre', {}, '');
    const button = el('button', { type: 'button', className: 'primary' }, 'Run test');

    const modeMismatch = connection && connection.modeName !== __AUTH_MODE__;
    button.addEventListener('click', async () => {
        if (!settings.connection) {
            setVerdict(verdict, 'fail', 'No connection chosen yet. Open the widget settings.');
            return;
        }
        button.disabled = true;
        setVerdict(verdict, 'idle', 'Calling the test API through the Portal proxy...');
        details.textContent = '';
        try {
            const response = await ctx.service(settings.connection)('check?probe=widget', { headers: { accept: 'application/json' } });
            const text = await response.text();
            const body = parseVerdict(text);
            if (!body) {
                setVerdict(verdict, 'fail', `FAIL: HTTP ${response.status} from the proxy, not the test API.`);
                details.textContent = text.slice(0, 800);
                return;
            }
            const result = judge(body);
            setVerdict(verdict, result.pass ? 'pass' : 'fail', result.text);
            details.textContent = JSON.stringify({ httpStatus: response.status, ...body }, null, 2);
        } catch (error) {
            const message =
                error instanceof ServiceConnectionNotFoundError || error instanceof TypeError ? error.message : String(error);
            setVerdict(verdict, 'fail', `FAIL: ${message}`);
        } finally {
            button.disabled = false;
        }
    });

    ctx.root.append(
        el(
            'div',
            { className: 'card' },
            el('h3', {}, `Auth test: ${__AUTH_MODE__}`),
            el('p', { className: 'muted' }, describeConnection(connection)),
            ...(modeMismatch
                ? [el('p', { className: 'verdict fail' }, `The linked connection uses ${connection?.modeName}; this widget tests ${__AUTH_MODE__}.`)]
                : []),
            el('p', { className: 'muted' }, ctx.inputs.authToken ? 'Signed in.' : 'Anonymous visitor.'),
            button,
            verdict,
            details
        )
    );
}

function parseVerdict(text: string): UpstreamVerdict | undefined {
    try {
        const body = JSON.parse(text) as Partial<UpstreamVerdict>;
        return typeof body.mode === 'string' && typeof body.accepted === 'boolean' ? (body as UpstreamVerdict) : undefined;
    } catch {
        return undefined;
    }
}

/** The tenant's connections as the Portal's admin API lists them (admins only, secrets masked). */
async function loadConnections(ctx: WidgetContext<TestSettings>): Promise<ServiceConnection[]> {
    const response = await ctx.fetch('api/v2/admin/serviceconnections');
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as ServiceConnection[];
}

function mountSettings(ctx: WidgetContext<TestSettings>): void {
    const settings = withDefaults(ctx.inputs.configuration, schema);
    const select = el('select', { name: 'connection', disabled: true });
    select.append(el('option', { value: '' }, 'Loading connections...'));
    loadConnections(ctx)
        .then(connections => {
            select.replaceChildren(el('option', { value: '' }, '(choose)'));
            for (const connection of connections) {
                const mode = connection.security?.mode;
                select.append(
                    el(
                        'option',
                        { value: connection.id, selected: connection.id === settings.connection },
                        `${connection.name} (mode ${mode ?? '?'})`
                    )
                );
            }
            select.disabled = false;
        })
        .catch(error => select.replaceChildren(el('option', { value: '' }, `Could not load connections: ${String(error)}`)));

    const form = el(
        'form',
        { className: 'card' },
        el('h3', {}, `Settings: auth test ${__AUTH_MODE__}`),
        el('p', { className: 'muted' }, `Choose the connection with mode ${__AUTH_MODE__}. The credential stays in the connection.`),
        el('label', {}, 'Service Connection', select),
        el(
            'div',
            { className: 'actions' },
            el('button', { type: 'submit', className: 'primary' }, 'Save'),
            el('button', { type: 'button', onclick: () => ctx.cancel() }, 'Cancel')
        )
    );
    form.addEventListener('submit', event => {
        event.preventDefault();
        // serviceConnectionsId links the connection to this instance; the proxy refuses unlinked connections.
        ctx.save({ connection: select.value }, { serviceConnectionsId: select.value ? [select.value] : [] });
    });
    ctx.root.append(form);
}

function mount(ctx: WidgetContext<TestSettings>): void {
    if (ctx.inputs.settingsMode && ctx.inputs.isAdminMode) {
        mountSettings(ctx);
    } else {
        mountWidget(ctx);
    }
}

function clear(ctx: WidgetContext<TestSettings>): void {
    for (const child of Array.from(ctx.root.childNodes)) {
        if (!(child instanceof HTMLStyleElement)) {
            child.remove();
        }
    }
}

definePortalWidget<TestSettings>({
    tag: __WIDGET_TAG__,
    cssMode: 'light',
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
