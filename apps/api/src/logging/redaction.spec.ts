import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACTED_LOG_PATHS } from './logging.module';

function logOnce(fields: Record<string, unknown>): Record<string, unknown> {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  const logger = pino({ redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' } }, destination);
  logger.info(fields, 'test');
  return JSON.parse(lines.join('')) as Record<string, unknown>;
}

describe('log redaction', () => {
  it('redacts sensitive fields logged at the top level', () => {
    const line = logOnce({ apiKey: 'rf_key', signingSecret: 'whsec_x', token: 't', keep: 'ok' });

    expect(line).toMatchObject({
      apiKey: '[REDACTED]',
      signingSecret: '[REDACTED]',
      token: '[REDACTED]',
      keep: 'ok',
    });
  });

  it('redacts sensitive fields one level down and credential headers', () => {
    const line = logOnce({
      endpoint: { secret: 'whsec_x', url: 'https://example.com' },
      req: { headers: { authorization: 'Bearer rf_key', 'webhook-signature': 'v1,abc' } },
    });

    expect(line).toMatchObject({
      endpoint: { secret: '[REDACTED]', url: 'https://example.com' },
      req: { headers: { authorization: '[REDACTED]', 'webhook-signature': '[REDACTED]' } },
    });
  });
});
