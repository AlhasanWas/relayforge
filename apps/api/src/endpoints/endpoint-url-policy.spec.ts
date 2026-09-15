import { AppError } from '../errors/app-error';
import { assertEndpointUrlAllowed } from './endpoint-url-policy';

const strict = { allowHttp: false };
const development = { allowHttp: true };

describe('assertEndpointUrlAllowed', () => {
  it('accepts https URLs with ports, paths and query strings', () => {
    expect(
      assertEndpointUrlAllowed('https://hooks.example.com:8443/relay?source=rf', strict).hostname,
    ).toBe('hooks.example.com');
  });

  it('accepts http only when explicitly allowed', () => {
    expect(() => assertEndpointUrlAllowed('http://webhook-sink:4000/webhooks', strict)).toThrow(
      AppError,
    );
    expect(assertEndpointUrlAllowed('http://webhook-sink:4000/webhooks', development).port).toBe(
      '4000',
    );
  });

  it.each([
    ['a relative URL', '/webhooks'],
    ['another scheme', 'ftp://example.com/hooks'],
    ['embedded credentials', 'https://user:pass@example.com/hooks'],
    ['a fragment', 'https://example.com/hooks#section'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertEndpointUrlAllowed(url, development)).toThrow(
      expect.objectContaining({ code: 'INVALID_ENDPOINT_URL' }) as Error,
    );
  });
});
