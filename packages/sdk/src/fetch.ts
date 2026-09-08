/**
 * Authenticated fetch against the Portal API (docs/sdk.md section 5, docs/security.md section 3).
 * The bearer token is attached only when the resolved request URL lives under `apiUrl`,
 * compared on parsed origin + path prefix so `https://portal.example.com.evil.net` never qualifies.
 */

export interface PortalAuth {
    apiUrl: string;
    authToken: string;
}

function parseBase(apiUrl: string): URL | null {
    if (!apiUrl) {
        return null;
    }
    try {
        const base = new URL(apiUrl);
        if (!base.pathname.endsWith('/')) {
            base.pathname += '/';
        }
        return base;
    } catch {
        return null;
    }
}

export function isUnderBase(url: URL, base: URL): boolean {
    return url.origin === base.origin && `${url.pathname}/`.startsWith(base.pathname);
}

function resolveUrl(input: string, base: URL | null): string {
    try {
        const fallback = typeof location !== 'undefined' ? location.href : undefined;
        return new URL(input, base ? base.href : fallback).href;
    } catch {
        return input;
    }
}

/**
 * Returns a `fetch`-compatible function. `getAuth` is read on every call so the
 * token stays current after the Portal renews it. Relative URLs are resolved
 * against `apiUrl`; an already present `Authorization` header is left untouched.
 *
 * This authenticates the current user against the Portal API and nothing else.
 * There is currently no secure way for a widget to call a third-party API with a
 * private key: the browser exposes everything, and the Portal has no server-side
 * proxy for Service Connections yet. Keep private keys in a backend you control.
 * See the package README, first section.
 */
export function createPortalFetch(getAuth: () => PortalAuth): typeof fetch {
    return (input, init) => {
        const { apiUrl, authToken } = getAuth();
        const base = parseBase(apiUrl);

        let request: Request;
        if (typeof input === 'string' || input instanceof URL) {
            request = new Request(resolveUrl(String(input), base), init);
        } else {
            request = init ? new Request(input, init) : input;
        }

        if (authToken && base && !request.headers.has('authorization')) {
            let target: URL | null = null;
            try {
                target = new URL(request.url);
            } catch {
                target = null;
            }
            if (target && isUnderBase(target, base)) {
                const headers = new Headers(request.headers);
                headers.set('Authorization', `Bearer ${authToken}`);
                request = new Request(request, { headers });
            }
        }

        return fetch(request);
    };
}
