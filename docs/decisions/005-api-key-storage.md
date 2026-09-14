# ADR 005: API key storage and authentication

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

Management API callers authenticate with API keys. A key is a bearer credential:
anyone holding it can act on its workspace. The design must survive a database
leak, make revocation immediate, let operators identify keys without seeing
them, and keep per-request overhead low.

## Decision

**Format.** `rf_<16 hex>_<43 base64url>`.

- `rf_<16 hex>` is a public prefix (64 random bits), stored in clear and shown in
  the UI, audit metadata and logs so a person can say "revoke `rf_3f9c…`".
- The remainder is 256 bits from `crypto.randomBytes`.
- The `rf_` marker makes leaked keys recognisable to secret scanners.

**Storage.** Only `SHA-256(full key)` is stored, in a `UNIQUE` column. The
plaintext key is returned once, in the creation response, and never persisted or
logged. Lookup is a single indexed equality on the hash.

**Why not bcrypt, scrypt or Argon2.** Slow hashes exist to make guessing
low-entropy secrets (passwords) expensive. A 256-bit random key cannot be
brute-forced whatever the hash cost, so a slow hash would add tens of
milliseconds to every authenticated request and buy no security. Slow hashes also
salt each value, which rules out lookup by hash and forces a prefix lookup
followed by a comparison.

**Verification.** On every request the guard hashes the presented key, loads the
row and rejects it if it does not exist or `revoked_at` is set. There is no key
cache, so revocation takes effect on the next request. Unknown and revoked keys
get the same `401` response.

**Revocation.** `DELETE /v1/api-keys/:id` sets `revoked_at`; rows are never
deleted. Database triggers make revocation permanent and the prefix, hash, role
and workspace immutable. The last active `ADMIN` key of a workspace cannot be
revoked. Concurrent revocations lock the workspace's active admin keys
(`SELECT … FOR UPDATE`, id order), so two admins revoking each other cannot both
succeed.

**Authorisation.** Keys carry a role: `ADMIN` (manages API keys and runs
reconciliation) or `MEMBER`. The workspace is taken from the key, never from
request input.

**Auditing.** Creation and revocation write an `AuditLog` row in the same database
transaction. Audit metadata holds only the name, role and prefix.

## Consequences

- A database leak exposes hashes of keys that cannot be reversed or guessed.
- Every authenticated request costs one indexed read. `last_used_at` is updated at
  most once per minute per key, so reads do not turn into writes.
- A lost key cannot be recovered; the user creates a new one.
- There are no key expiry dates or scopes finer than two roles. Both are future
  work.

## Alternatives considered

- **HMAC-SHA256 with a server-side pepper.** This would also protect against a
  leak of the database alone. It was not adopted because rotating the pepper
  invalidates every key at once, and 256-bit keys already make the hashes useless
  to an attacker. It can be added later without changing the key format.
- **Caching authenticated keys in Redis.** This would save a database read, but
  revocation would lag by up to the cache TTL, and authentication would depend on
  Redis. Rejected.
- **JWTs.** Self-contained tokens cannot be revoked without a denylist, which
  reintroduces a lookup on every request. Rejected.
