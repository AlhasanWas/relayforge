import { createHash, randomBytes } from 'node:crypto';

/**
 * API key format: `rf_<16 hex>_<43 base64url>`.
 *
 * - `rf_<16 hex>` is the public prefix: stored in clear, shown in UIs and logs, and
 *   used by humans to identify a key. 64 bits make collisions negligible.
 * - The remainder carries 256 bits of randomness.
 *
 * Only the SHA-256 hash of the full key is stored. A slow password hash (bcrypt,
 * argon2) is unnecessary for 256-bit random secrets, which cannot be brute-forced,
 * and would add latency to every authenticated request. See ADR 005.
 */
const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;
const API_KEY_PATTERN = /^(rf_[0-9a-f]{16})_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  /** Returned to the caller exactly once; never stored or logged. */
  readonly key: string;
  readonly prefix: string;
  readonly hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = `rf_${randomBytes(PREFIX_BYTES).toString('hex')}`;
  const key = `${prefix}_${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Cheap syntactic check that avoids a database lookup for obviously invalid keys. */
export function isWellFormedApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

/**
 * The public prefix of a well-formed key. Parsed with the format pattern rather than
 * by splitting on "_", because the base64url secret may itself contain underscores.
 */
export function apiKeyPrefix(key: string): string | undefined {
  return API_KEY_PATTERN.exec(key)?.[1];
}

/** Extracts the credential from an `Authorization: Bearer <key>` header value. */
export function parseBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  return match?.[1];
}
