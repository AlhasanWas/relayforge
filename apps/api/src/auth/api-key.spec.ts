import { createHash } from 'node:crypto';
import {
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
  parseBearerToken,
} from './api-key';

describe('generateApiKey', () => {
  it('produces a well-formed key whose prefix is its public part', () => {
    const { key, prefix } = generateApiKey();

    expect(isWellFormedApiKey(key)).toBe(true);
    expect(prefix).toMatch(/^rf_[0-9a-f]{16}$/);
    expect(key.startsWith(`${prefix}_`)).toBe(true);
  });

  it('stores only a SHA-256 hash of the full key', () => {
    const { key, hash } = generateApiKey();

    expect(hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hash).not.toContain(key.slice('rf_'.length + 17));
  });

  it('generates unique keys and prefixes', () => {
    const keys = Array.from({ length: 200 }, () => generateApiKey());

    expect(new Set(keys.map((k) => k.key)).size).toBe(200);
    expect(new Set(keys.map((k) => k.prefix)).size).toBe(200);
  });
});

describe('hashApiKey', () => {
  it('is deterministic so keys can be looked up by hash', () => {
    const { key } = generateApiKey();

    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });
});

describe('isWellFormedApiKey', () => {
  const { key } = generateApiKey();

  it.each([
    ['an empty string', ''],
    ['a key without the rf_ prefix', key.slice(3)],
    ['a truncated key', key.slice(0, -1)],
    ['a key with a trailing character', `${key}x`],
    ['a key with uppercase hex in the prefix', key.replace(/^rf_[0-9a-f]/, 'rf_A')],
  ])('rejects %s', (_label, value) => {
    expect(isWellFormedApiKey(value)).toBe(false);
  });
});

describe('apiKeyPrefix', () => {
  it('returns the generated prefix', () => {
    const { key, prefix } = generateApiKey();

    expect(apiKeyPrefix(key)).toBe(prefix);
  });

  it('is not confused by underscores inside the secret', () => {
    const key = 'rf_ba7773086dddea59_qyogN_v52ghNawks7KjNZ3jwNcVHVA2_vfrHNE-0R40';

    expect(isWellFormedApiKey(key)).toBe(true);
    expect(apiKeyPrefix(key)).toBe('rf_ba7773086dddea59');
  });

  it('returns undefined for malformed keys', () => {
    expect(apiKeyPrefix('rf_short')).toBeUndefined();
  });
});

describe('parseBearerToken', () => {
  it('extracts the token from a bearer header', () => {
    expect(parseBearerToken('Bearer rf_abc')).toBe('rf_abc');
  });

  it.each([
    ['a missing header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['a lowercase scheme', 'bearer rf_abc'],
    ['an empty token', 'Bearer '],
    ['a token containing spaces', 'Bearer rf_abc extra'],
  ])('returns undefined for %s', (_label, header) => {
    expect(parseBearerToken(header)).toBeUndefined();
  });
});
