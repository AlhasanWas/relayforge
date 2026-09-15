# Security

This document describes RelayForge's threat model, the controls that are implemented,
and the gaps that are deliberately left for a production deployment. RelayForge is a
portfolio project: the controls below are real and tested, but it has not had an
external security review.

## Threat model

| Asset                                  | Threat                                             | Primary control                                                   |
| -------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Financial state (transactions, ledger) | Forged or replayed provider webhooks               | Signature verification, timestamp tolerance, idempotency          |
| Workspace data                         | Stolen or guessed API keys; cross-workspace access | 256-bit hashed keys, immediate revocation, workspace from the key |
| Signing secrets                        | Database leak, log leak                            | AES-256-GCM encryption at rest, log redaction                     |
| Internal network                       | Server-side request forgery through endpoint URLs  | Destination guard on resolved addresses, no redirects             |
| Availability                           | Request floods, oversized bodies, slow receivers   | Rate limits, body limits, delivery timeouts and concurrency caps  |
| Audit trail                            | Tampering after the fact                           | Append-only tables enforced by database triggers                  |

## Incoming webhooks

**Routing is not authentication.** A provider posts to
`POST /v1/webhooks/:publicIngressKey`. The ingress key only selects the provider
connection; it appears in URLs, provider dashboards and logs, and is not a secret.
Every request is authenticated by its signature.

**Signature verification** follows [Standard Webhooks](https://www.standardwebhooks.com/):

- HMAC-SHA256 over `webhook-id.webhook-timestamp.body`, computed on the **raw
  request bytes** before any JSON parsing, so re-serialisation cannot change what
  is verified.
- Candidate signatures are compared with `crypto.timingSafeEqual`.
- The signature is checked before the timestamp. A request with a valid signature
  but a timestamp outside the connection's tolerance is rejected, which bounds how
  long a captured request can be replayed. Tolerance is set per provider
  connection; the seeded MockPay connection uses 300 seconds, and a connection
  without a tolerance skips the timestamp check.
- The MockPay adapter requires the signed `webhook-id` to equal the event id in the
  payload, so a signature for one event cannot be attached to another. Each new
  provider adapter must make the same check.
- Verification is behind a `WebhookSignatureVerifier` interface; only the Standard
  Webhooks verifier is implemented.

**Replays within the tolerance window** are absorbed by idempotency: the
`UNIQUE (provider_connection_id, external_event_id)` constraint means a replayed
event is acknowledged as a duplicate and changes nothing. The same event id with a
different payload is rejected as a conflict and the original is kept.

**Rejected requests** are stored in `rejected_webhook_attempts` as security records:

- Stored: the reason, the SHA-256 of the body, its size, the request id, the source
  IP, and a few diagnostic headers (`webhook-id`, `webhook-timestamp`,
  `content-type`, `user-agent`, each truncated to 256 characters). For
  schema-invalid payloads, the issue paths and validation messages are stored, never
  the offending values; for payload conflicts, the conflicting event ids.
- Requests to an unknown ingress key have no connection or workspace to attach a
  record to; they are answered `404` and only logged.
- Not stored: the body, the signature header, or any secret.
- Rejections are written outside business transactions and never touch the
  idempotency key space, so a forged request cannot reserve an event id ahead of
  the genuine event.
- The table is append-only (triggers reject updates and deletes).

## Management API authentication

API keys are bearer credentials of the form `rf_<16 hex>_<43 base64url>`. See
[ADR 005](decisions/005-api-key-storage.md) for the full rationale.

- Keys carry 256 bits of randomness. Only `SHA-256(key)` is stored; the key is shown
  once at creation and never logged.
- A fast hash is used deliberately: slow password hashes protect low-entropy
  secrets and add latency to every request without adding security here.
- Revocation takes effect on the next request (no cache). Unknown and revoked keys
  both receive `401`. Revocation is permanent, enforced by a trigger, and the last
  active admin key of a workspace cannot be revoked.
- The workspace is always derived from the key, never from request input. Queries
  for another workspace's resources return `404`.
- Two roles: `ADMIN` (API keys, endpoint changes, replay, reconciliation) and
  `MEMBER` (read access). Finer scopes and key expiry are future work.
- Key creation and revocation, endpoint changes and replays are written to the
  append-only audit log in the same transaction as the action (an endpoint update
  that changes nothing writes no entry). Reconciliation runs
  are read-only and audited in a separate transaction once the report is built.

## Secrets at rest

Signing secrets must be recoverable (RelayForge signs outgoing webhooks and verifies
incoming ones), so they cannot be hashed.

- They are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (32 random bytes,
  base64). Each value has its own random IV and authentication tag.
- The purpose (for example provider connection secret versus endpoint secret) is
  bound as additional authenticated data, so a ciphertext copied between columns
  fails to decrypt.
- An endpoint's signing secret is returned once, when the endpoint is created.
- **Not implemented:** key rotation. Rotating `ENCRYPTION_KEY` requires re-encrypting
  stored secrets; a production deployment would add key versioning or a KMS.

## Outgoing webhooks and SSRF

Endpoint URLs are customer input, so RelayForge must not become a proxy into its own
network.

- URLs must be `https` unless `ENDPOINT_ALLOW_HTTP=true`, and may not contain
  credentials or fragments.
- The destination guard checks the **resolved IP address at connection time**,
  inside the HTTP client's DNS lookup, rather than when the endpoint is saved. This
  defeats DNS rebinding, where a name resolves to a public address during
  validation and a private one during delivery. Literal IP URLs are checked the
  same way, including IPv4-mapped IPv6 addresses.
- Blocked ranges include loopback, RFC 1918 private networks, carrier-grade NAT,
  link-local (including cloud metadata at `169.254.169.254`), multicast, reserved
  and documentation ranges, IPv6 unique-local, link-local and site-local ranges, and
  IPv6 forms that embed an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, 6to4
  and Teredo).
- Redirects are never followed. A 3xx response is a non-retryable failure unless an
  operator adds it to `DELIVERY_RETRYABLE_STATUS_CODES`.
- Requests time out (`DELIVERY_TIMEOUT_MS`), and only the first
  `DELIVERY_RESPONSE_BODY_MAX_BYTES` of a response body are stored.
- `DELIVERY_ALLOW_PRIVATE_DESTINATIONS=true` disables the guard. The local Docker
  Compose stack sets it so the demo can deliver to the webhook sink container; it
  must stay `false` anywhere else.

Receivers verify RelayForge's deliveries with the endpoint's signing secret using
the same Standard Webhooks scheme, and should deduplicate on `webhook-id` (see
[reliability.md](reliability.md)).

## Abuse and resource limits

- **Rate limiting** uses fixed windows stored in Redis: per API key for the
  management API (`RATE_LIMIT_MANAGEMENT_MAX`) and per ingress key and client IP for
  ingestion (`RATE_LIMIT_INGESTION_MAX`). Exceeding a limit returns `429` with
  `Retry-After`.
- **Fail-open.** If Redis is unavailable the limiter allows the request and logs a
  warning. PostgreSQL stays the only hard dependency for accepting webhooks, at the
  cost of no rate limiting during a Redis outage. A deployment that prefers to fail
  closed would change this in `RedisThrottlerStorage`.
- **Client IP and proxies.** By default the socket address is used and
  `X-Forwarded-For` is ignored, so clients cannot spoof their IP. Behind reverse
  proxies, set `HTTP_TRUST_PROXY_HOPS` to the exact number of trusted hops.
- **Body limits:** `INGESTION_MAX_BODY_BYTES` for webhooks and
  `HTTP_JSON_BODY_LIMIT_BYTES` for the management API; larger bodies get `413`.
- Fixed windows allow up to twice the limit across a window boundary; this is an
  accepted trade-off for simplicity.

## Logging

- Structured JSON logs (pino). Every log line written while handling a request
  carries its request id.
- Request logs contain the request id, method, URL, status and response time, and
  never headers or bodies. As defence in depth, `authorization`, `cookie`,
  `x-api-key` and `webhook-signature` headers and fields named `apiKey`, `secret`,
  `signingSecret`, `password` or `token` (at the top level of a log object or one
  level down) are redacted.
- Error responses use one envelope with a request id and never include stack
  traces or internal messages for unexpected errors.
- Ingress keys appear in URLs and therefore in logs, which is acceptable because
  they are not secrets.

## Dashboard access

The dashboard is a local operator console with **no login**.

- It acts as the seeded demo workspace with a workspace API key
  (`DASHBOARD_API_KEY`) held only by the Next.js server process. The browser never
  receives the key and never calls the API directly.
- Docker Compose publishes it on `127.0.0.1` only, because anyone who can reach it
  can use its admin key (for example to replay deliveries).
- Mutations are Next.js server actions, which reject cross-origin requests.
- **Out of scope:** user accounts, SSO, sessions and per-user authorisation. A real
  deployment would put the dashboard behind an identity provider and give each
  operator their own identity and audit trail.

## Development defaults

`.env.example` contains fixed demo credentials (`ENCRYPTION_KEY`,
`SEED_ADMIN_API_KEY`, `DASHBOARD_API_KEY`, the MockPay signing secret) so that
`docker compose up` works without setup. They are public and for local use only.
The seed script refuses to run with `NODE_ENV=production`. The Swagger UI is on by
default for local use; set `SWAGGER_ENABLED=false` in production.

## Known gaps and future work

- No retention for rejected attempts, audit logs or delivery history. The tables
  are protected against deletion, so retention needs a deliberate migration
  (for example partitioning by month and detaching old partitions).
- No `ENCRYPTION_KEY` rotation, API key expiry or fine-grained scopes.
- No IP allowlisting of providers, and no mutual TLS.
- No automated dependency or container image scanning beyond pinned versions and the
  pnpm release-age quarantine.
- No external penetration test or security review.
