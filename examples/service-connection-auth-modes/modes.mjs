/**
 * The six test widgets, one per Service Connection security mode. `segment` is the path of the matching
 * test API endpoint (upstream.mjs): the connection's base URL is `http://<host>:<port>/<segment>`.
 * Tags contain no digits (Portal storage rule), hence `oauth` rather than `oauth2`.
 */
export const MODES = [
    { mode: 'None', tag: 'auth-mode-none', segment: 'none', title: 'None' },
    { mode: 'BearerToken', tag: 'auth-mode-bearer', segment: 'bearer', title: 'Bearer token' },
    { mode: 'Custom', tag: 'auth-mode-custom', segment: 'custom', title: 'Custom (header + query)' },
    { mode: 'Basic', tag: 'auth-mode-basic', segment: 'basic', title: 'Basic' },
    { mode: 'OAuth2ClientCredentials', tag: 'auth-mode-oauth', segment: 'oauth', title: 'OAuth 2.0 client credentials' },
    { mode: 'ForwardUserToken', tag: 'auth-mode-forward', segment: 'forward', title: 'Forward user token' }
];

/**
 * Test credentials the test API accepts; the admin types them into the Service Connections. Test values for a
 * local test API, not secrets. Override with environment variables when running upstream.mjs.
 * build.mjs refuses a bundle that contains any of them: a widget must never carry a credential.
 */
export const TEST_CREDENTIALS = {
    bearerToken: process.env.TEST_BEARER_TOKEN || 'test-bearer-token',
    apiKeyHeader: 'x-api-key',
    apiKey: process.env.TEST_API_KEY || 'test-api-key',
    queryName: 'appid',
    queryValue: process.env.TEST_APP_ID || 'test-app-id',
    basicUser: process.env.TEST_BASIC_USER || 'portal-test',
    basicPassword: process.env.TEST_BASIC_PASSWORD || 'test-basic-password',
    clientId: process.env.TEST_CLIENT_ID || 'portal-test-client',
    clientSecret: process.env.TEST_CLIENT_SECRET || 'test-client-secret'
};
