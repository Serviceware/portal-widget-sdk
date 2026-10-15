import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_PROXY_PATH, SERVICE_PROXY_STATUS, serviceProxyPath, WIDGET_INSTANCE_HEADER } from './contract';
import {
    createServiceClient,
    listServiceConnections,
    resolveServiceConnection,
    ServiceConnectionNotFoundError
} from './service-client';
import type { ServiceConnection, WidgetConfig } from './types';

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

describe('anonymous callers', () => {
    it('sends no Authorization header without a Portal token, but still the instance header', async () => {
        await createServiceClient(() => ({ apiUrl: API_URL, authToken: '', configuration: config() }), 'weather')('x', {
            headers: { Authorization: 'Bearer my-own-key' }
        });

        const request = requests[0]!;
        expect(request.headers.has('authorization')).toBe(false);
        expect(request.headers.get(WIDGET_INSTANCE_HEADER)).toBe(INSTANCE_ID);
    });

    it('returns proxy answers unchanged and does not retry', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                requests.push(input as Request);
                return new Response('{"title":"Too many requests"}', {
                    status: SERVICE_PROXY_STATUS.tooManyRequests,
                    headers: { 'content-type': 'application/problem+json', 'retry-after': '30' }
                });
            })
        );

        const response = await createServiceClient(() => ({ apiUrl: API_URL, authToken: '', configuration: config() }), 'weather')('x');

        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('30');
        expect(requests).toHaveLength(1);
    });
});

describe('listServiceConnections', () => {
    const SECRET_VALUES = ['********', 'real-key', 'pw', 'client-secret'];

    function connection(id: string, security: unknown, extra: Record<string, unknown> = {}): ServiceConnection {
        return { id, name: id, module: 'portal', url: `https://${id}.example`, isDefault: false, security, ...extra } as ServiceConnection;
    }

    const all = config({
        serviceConnections: [
            connection('none', { mode: 0 }),
            connection('bearer', { mode: 1, headers: [{ key: 'Authorization', value: 'Bearer ********' }] }, { isDefault: true }),
            connection('custom', { mode: 2, headers: [{ key: 'x-api-key', value: '********' }], queryParameters: [{ key: 'appid', value: 'real-key' }], allowAnonymous: true }),
            connection('custom-empty', { mode: 2, headers: [] }),
            connection('basic', { mode: 3, basic: { username: 'svc', password: 'pw' } }, { url: null }),
            connection('oauth', { mode: 4, oAuth2: { tokenUrl: 'https://idp.example/token', clientId: 'portal', clientSecret: 'client-secret' } }),
            connection('forward', { mode: 5 }),
            connection('legacy', '{"mode":2,"headers":[{"key":"x-api-key","value":"real-key"}]}'),
            connection('broken', 'not json'),
            connection('future', { mode: 9 })
        ]
    });

    it('describes every linked connection with mode, flags and url', () => {
        expect(listServiceConnections(all).map(c => [c.id, c.mode, c.modeName, c.hasCredentials, c.allowAnonymous])).toEqual([
            ['none', 0, 'None', false, false],
            ['bearer', 1, 'BearerToken', true, false],
            ['custom', 2, 'Custom', true, true],
            ['custom-empty', 2, 'Custom', false, false],
            ['basic', 3, 'Basic', true, false],
            ['oauth', 4, 'OAuth2ClientCredentials', true, false],
            ['forward', 5, 'ForwardUserToken', false, false],
            ['legacy', 2, 'Custom', true, false],
            ['broken', 0, 'None', false, false],
            ['future', 9, 'Unknown', false, false]
        ]);
        const [none, bearer, , , basic] = listServiceConnections(all);
        expect(none).toEqual({
            id: 'none',
            name: 'none',
            module: 'portal',
            mode: 0,
            modeName: 'None',
            isDefault: false,
            hasCredentials: false,
            allowAnonymous: false,
            url: 'https://none.example'
        });
        expect(bearer!.isDefault).toBe(true);
        expect(basic!.url).toBeNull();
    });

    it('never copies security details or secret values', () => {
        const json = JSON.stringify(listServiceConnections(all));
        for (const value of SECRET_VALUES) {
            expect(json).not.toContain(value);
        }
        expect(json).not.toContain('idp.example');
        for (const info of listServiceConnections(all)) {
            expect(Object.keys(info).sort()).toEqual(
                ['allowAnonymous', 'hasCredentials', 'id', 'isDefault', 'mode', 'modeName', 'module', 'name', 'url'].sort()
            );
        }
    });

    it('returns an empty list without configuration or links', () => {
        expect(listServiceConnections(undefined)).toEqual([]);
        expect(listServiceConnections(config({ serviceConnections: [] }))).toEqual([]);
    });
});
