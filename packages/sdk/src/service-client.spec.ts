import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_PROXY_PATH, serviceProxyPath, WIDGET_INSTANCE_HEADER } from './contract';
import { createServiceClient, resolveServiceConnection, ServiceConnectionNotFoundError } from './service-client';
import type { WidgetConfig } from './types';

const API_URL = 'https://portal.example.com/api-gateway';
const CONNECTION_ID = '5b0c7c0e-8f3a-4d7e-9d52-2f8f1c1d9a10';
const INSTANCE_ID = 'c3a1b0f2-0000-4000-8000-000000000001';

function config(overrides: Partial<WidgetConfig<unknown>> = {}): WidgetConfig<unknown> {
    return {
        id: INSTANCE_ID,
        routeId: 1,
        customConfig: {},
        serviceConnectionsId: [CONNECTION_ID],
        serviceConnections: [
            {
                id: CONNECTION_ID,
                name: 'weather',
                module: 'widgets',
                url: 'https://api.weather.example/v1',
                isDefault: false,
                security: { mode: 2, headers: [{ key: 'x-api-key', value: '********' }] }
            }
        ],
        ...overrides
    } as WidgetConfig<unknown>;
}

let requests: Request[];

beforeEach(() => {
    requests = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            requests.push(input as Request);
            return new Response('{}', { status: 200 });
        })
    );
});

afterEach(() => vi.unstubAllGlobals());

describe('contract', () => {
    it('builds the proxy path', () => {
        expect(SERVICE_PROXY_PATH).toBe('api/v1/proxy');
        expect(WIDGET_INSTANCE_HEADER).toBe('X-Portal-Widget-Instance');
        expect(serviceProxyPath('abc', '/forecast?city=Bonn')).toBe('api/v1/proxy/abc/forecast?city=Bonn');
        expect(serviceProxyPath('abc')).toBe('api/v1/proxy/abc/');
    });
});

describe('resolveServiceConnection', () => {
    it('finds by id, by linked id and by case-insensitive name', () => {
        expect(resolveServiceConnection(config(), CONNECTION_ID)?.id).toBe(CONNECTION_ID);
        expect(resolveServiceConnection(config({ serviceConnections: [] }), CONNECTION_ID)?.id).toBe(CONNECTION_ID);
        expect(resolveServiceConnection(config(), 'Weather')?.id).toBe(CONNECTION_ID);
        expect(resolveServiceConnection(config(), 'maps')).toBeUndefined();
        expect(resolveServiceConnection(undefined, CONNECTION_ID)).toBeUndefined();
    });
});

describe('createServiceClient', () => {
    const source = (configuration = config(), authToken = 'tok') => () => ({ apiUrl: API_URL, authToken, configuration });

    it('sends the request to the Portal proxy with the Portal token and the instance id', async () => {
        const weather = createServiceClient(source(), 'weather');

        await weather('forecast?city=Bonn', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });

        const request = requests[0]!;
        expect(request.url).toBe(`${API_URL}/api/v1/proxy/${CONNECTION_ID}/forecast?city=Bonn`);
        expect(request.method).toBe('POST');
        expect(request.headers.get('authorization')).toBe('Bearer tok');
        expect(request.headers.get('x-portal-widget-instance')).toBe(INSTANCE_ID);
        expect(request.headers.get('content-type')).toBe('application/json');
        expect(await request.text()).toBe('{"a":1}');
    });

    it('replaces a caller-supplied Authorization header with the Portal token', async () => {
        await createServiceClient(source(), CONNECTION_ID)('x', { headers: { Authorization: 'Bearer my-own-key' } });

        expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok');
    });

    it('reads configuration and token on every call', async () => {
        let current = { apiUrl: API_URL, authToken: 'old', configuration: config() };
        const client = createServiceClient(() => current, 'weather');
        await client('a');
        current = { ...current, authToken: 'new', configuration: config({ serviceConnections: [], serviceConnectionsId: [] }) };

        await expect(client('a')).rejects.toBeInstanceOf(ServiceConnectionNotFoundError);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.headers.get('authorization')).toBe('Bearer old');
    });

    it('rejects when the connection is not linked', async () => {
        await expect(createServiceClient(source(), 'maps')('x')).rejects.toThrow(ServiceConnectionNotFoundError);
        expect(requests).toHaveLength(0);
    });

    it.each(['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', '../admin', 'a/../../b', './a'])(
        'rejects %s without sending anything',
        async path => {
            await expect(createServiceClient(source(), 'weather')(path)).rejects.toBeInstanceOf(TypeError);
            expect(requests).toHaveLength(0);
        }
    );

    it('allows dots inside segments and in the query', async () => {
        await createServiceClient(source(), 'weather')('v1.2/file.json?next=../x');

        expect(requests[0]!.url).toBe(`${API_URL}/api/v1/proxy/${CONNECTION_ID}/v1.2/file.json?next=../x`);
    });
});
