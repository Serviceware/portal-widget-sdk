/**
 * Calls to third-party APIs through a Portal Service Connection (docs/sdk.md section 5a,
 * docs/security.md tier 1). EXPERIMENTAL: needs a Portal backend with the proxy endpoint.
 *
 * The widget never sees the API key: it sends the request to the Portal with the user's Portal
 * token, and the Portal replaces that token with the connection's stored headers.
 */
import { serviceProxyPath, WIDGET_INSTANCE_HEADER } from './contract';
import { createPortalFetch, PortalAuth } from './fetch';
import type { ServiceConnection, WidgetConfig } from './types';

/** `fetch` restricted to a path under the connection's base URL, e.g. `'forecast?city=Bonn'`. */
export type ServiceFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface ServiceClientSource extends PortalAuth {
    configuration: WidgetConfig<unknown> | undefined;
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
 * connection is not linked to this widget instance.
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
        // The Portal token must reach the proxy; the proxy strips it before calling upstream.
        headers.delete('authorization');
        headers.set(WIDGET_INSTANCE_HEADER, configuration.id);

        return portalFetch(serviceProxyPath(connection.id, path), { ...init, headers });
    };
}
