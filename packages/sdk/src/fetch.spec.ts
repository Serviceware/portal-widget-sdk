import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortalFetch } from './fetch';

const API_URL = 'https://portal.example.com/api-gateway';

let requests: Request[];

beforeEach(() => {
    requests = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            requests.push(input as Request);
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        })
    );
});

afterEach(() => vi.unstubAllGlobals());

const portalFetch = createPortalFetch(() => ({ apiUrl: API_URL, authToken: 'tok' }));

async function authHeaderFor(url: string, init?: RequestInit): Promise<string | null> {
    await portalFetch(url, init);
    return requests[requests.length - 1]!.headers.get('authorization');
}

describe('createPortalFetch', () => {
    it('adds the bearer token for URLs under apiUrl', async () => {
        expect(await authHeaderFor(`${API_URL}/storage/v1/widgets/x`)).toBe('Bearer tok');
        expect(await authHeaderFor(API_URL)).toBe('Bearer tok');
        expect(await authHeaderFor(`${API_URL}/`)).toBe('Bearer tok');
    });

    it('resolves relative URLs against apiUrl and authenticates them', async () => {
        expect(await authHeaderFor('storage/v1/widgets/acme/1.0.0/translations/en')).toBe('Bearer tok');
        expect(requests[0]!.url).toBe(`${API_URL}/storage/v1/widgets/acme/1.0.0/translations/en`);
    });

    it('never adds the token for a foreign origin', async () => {
        expect(await authHeaderFor('https://api.third-party.example/v1')).toBeNull();
    });

    it('never adds the token when apiUrl is only a string prefix of another host', async () => {
        expect(await authHeaderFor('https://portal.example.com.evil.net/api-gateway/x')).toBeNull();
    });

    it('never adds the token when apiUrl is only a string prefix of another path', async () => {
        expect(await authHeaderFor('https://portal.example.com/api-gatewayevil/x')).toBeNull();
    });

    it('never adds the token for same-origin paths outside apiUrl', async () => {
        expect(await authHeaderFor('https://portal.example.com/other/x')).toBeNull();
        expect(await authHeaderFor('/absolute-path')).toBeNull();
    });

    it('adds nothing when the token is empty (anonymous user)', async () => {
        const anonymous = createPortalFetch(() => ({ apiUrl: API_URL, authToken: '' }));
        await anonymous(`${API_URL}/x`);
        expect(requests[0]!.headers.get('authorization')).toBeNull();
    });

    it('keeps an explicitly provided Authorization header', async () => {
        expect(await authHeaderFor(`${API_URL}/x`, { headers: { Authorization: 'Basic abc' } })).toBe('Basic abc');
    });

    it('preserves method, body and other headers', async () => {
        await portalFetch(`${API_URL}/x`, {
            method: 'POST',
            body: '{"a":1}',
            headers: { 'content-type': 'application/json' }
        });
        const request = requests[0]!;
        expect(request.method).toBe('POST');
        expect(request.headers.get('content-type')).toBe('application/json');
        expect(request.headers.get('authorization')).toBe('Bearer tok');
        expect(await request.text()).toBe('{"a":1}');
    });

    it('reads the auth on every call so a renewed token is used', async () => {
        let token = 'first';
        const live = createPortalFetch(() => ({ apiUrl: API_URL, authToken: token }));
        await live(`${API_URL}/x`);
        token = 'second';
        await live(`${API_URL}/x`);
        expect(requests.map(r => r.headers.get('authorization'))).toEqual(['Bearer first', 'Bearer second']);
    });
});
