/**
 * Calls to third-party APIs through a Portal Service Connection (docs/sdk.md section 5a,
 * docs/security.md tier 1). Needs Portal 3 with the Service Connection proxy.
 *
 * The widget never sees the credential: it sends the request to the Portal (with the user's Portal
 * token when there is one), and the Portal adds the connection's credentials server-side.
 */
import { serviceProxyPath, WIDGET_INSTANCE_HEADER } from './contract';
import { createPortalFetch, PortalAuth } from './fetch';
import { SecurityModes, type SecurityModeName, type ServiceConnection, type WidgetConfig } from './types';

/** `fetch` restricted to a path under the connection's base URL, e.g. `'forecast?city=Bonn'`. */
export type ServiceFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface ServiceClientSource extends PortalAuth {
    configuration: WidgetConfig<unknown> | undefined;
}

/** What a widget may know about a linked connection. Never carries any secret or masked value. */
export interface ServiceConnectionInfo {
    id: string;
    name: string;
    module: string;
    /** Numeric security mode, see `SecurityModes`. */
    mode: number;
    modeName: SecurityModeName | 'Unknown';
    isDefault: boolean;
    /** The Portal adds a stored credential (modes BearerToken, Custom with entries, Basic, OAuth2ClientCredentials). */
    hasCredentials: boolean;
    /** The proxy may be used from anonymous pages. */
    allowAnonymous: boolean;
    /** Base URL of the third party; `null` when the Portal hides it (anonymous caller, connection with credentials). */
    url: string | null;
}

export class ServiceConnectionNotFoundError extends Error {
    constructor(readonly connection: string) {
        super(
            `Service connection "${connection}" is not linked to this widget instance. ` +
                'A Portal admin must link it in the widget settings.'
        );
        this.name = 'ServiceConnectionNotFoundError';
    }
}

/** Finds a linked connection by id, or by name (case-insensitive; the Portal lower-cases names). */
export function resolveServiceConnection(
    config: WidgetConfig<unknown> | undefined,
    connectionIdOrName: string
): Pick<ServiceConnection, 'id'> | undefined {
    const connections = config?.serviceConnections ?? [];
    const byId = connections.find(connection => connection.id === connectionIdOrName);
    if (byId) {
        return byId;
    }
    if (config?.serviceConnectionsId?.includes(connectionIdOrName)) {
        return { id: connectionIdOrName };
    }
    const name = connectionIdOrName.toLowerCase();
    return connections.find(connection => connection.name?.toLowerCase() === name);
}

function readSecurity(security: unknown): Record<string, unknown> {
    // Portals before the proxy send `security` as a JSON string.
    if (typeof security === 'string') {
        try {
            security = JSON.parse(security);
        } catch {
            return {};
        }
    }
    return security && typeof security === 'object' ? (security as Record<string, unknown>) : {};
}

const hasEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * Safe description of the connections linked to this widget instance (`configuration.serviceConnections`).
 * Only ids, names, mode and flags are copied; header, query, password and secret values never are.
 */
export function listServiceConnections(config: WidgetConfig<unknown> | undefined): ServiceConnectionInfo[] {
    return (config?.serviceConnections ?? []).map(connection => {
        const security = readSecurity(connection.security);
        const mode = typeof security.mode === 'number' ? security.mode : SecurityModes.None;
        const modeName =
            (Object.keys(SecurityModes) as SecurityModeName[]).find(name => SecurityModes[name] === mode) ?? 'Unknown';
        const hasCredentials =
            mode === SecurityModes.BearerToken ||
            mode === SecurityModes.Basic ||
            mode === SecurityModes.OAuth2ClientCredentials ||
            (mode === SecurityModes.Custom && (hasEntries(security.headers) || hasEntries(security.queryParameters)));
        return {
            id: connection.id,
            name: connection.name,
            module: connection.module,
            mode,
            modeName,
            isDefault: connection.isDefault === true,
            hasCredentials,
            allowAnonymous: security.allowAnonymous === true,
            url: typeof connection.url === 'string' && connection.url ? connection.url : null
        };
    });
}

function assertRelativePath(path: string): void {
    // Anything with a scheme or authority would let the caller pick the host.
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
        throw new TypeError(`Service client: pass a path relative to the connection, not a URL ("${path}").`);
    }
    const pathname = path.split(/[?#]/, 1)[0]!;
    if (pathname.split('/').some(segment => segment === '.' || segment === '..')) {
        throw new TypeError(`Service client: "." and ".." path segments are not allowed ("${path}").`);
    }
}

/**
 * Returns a fetch for one Service Connection. `getSource` is read on every call so token renewal and
 * re-saved configuration are picked up. Rejects with `ServiceConnectionNotFoundError` when the
 * connection is not linked to this widget instance. Proxy answers (401, 404, 429, 502, 504, …) come
 * back as the `Response`, unchanged; nothing is retried.
 */
export function createServiceClient(getSource: () => ServiceClientSource, connectionIdOrName: string): ServiceFetch {
    const portalFetch = createPortalFetch(getSource);

    return async (path, init) => {
        assertRelativePath(path);
        const { configuration } = getSource();
        const connection = resolveServiceConnection(configuration, connectionIdOrName);
        if (!connection || !configuration) {
            throw new ServiceConnectionNotFoundError(connectionIdOrName);
        }

        const headers = new Headers(init?.headers);
        // Only the Portal token may reach the proxy (none for anonymous users); the proxy strips it.
        headers.delete('authorization');
        headers.set(WIDGET_INSTANCE_HEADER, configuration.id);

        return portalFetch(serviceProxyPath(connection.id, path), { ...init, headers });
    };
}
