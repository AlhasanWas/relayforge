# Security Policy

## Threat Model & Security Boundaries

RelayForge is engineered with defense-in-depth security principles tailored for financial transactions and distributed webhook ingestion:

1. **Ingress Authentication:** Standard Webhooks HMAC-SHA256 signatures are evaluated in constant time using `crypto.timingSafeEqual` directly against raw incoming request byte buffers. Timestamp tolerances prevent replay attacks.
2. **Denial-of-Service Defense:** Unattributable webhook requests (unknown ingress keys) are rejected at the edge and never written to PostgreSQL to prevent unauthenticated table saturation.
3. **Secrets at Rest:** Provider signing secrets and endpoint delivery secrets are encrypted using AES-256-GCM with purpose-bound Additional Authenticated Data (AAD).
4. **SSRF & DNS Rebinding Protection:** Outbound webhook dispatch addresses are resolved and checked against an RFC 1918, Link-Local (including cloud metadata `169.254.169.254`), and IPv6 embedding blocklist at socket creation. HTTP redirects are strictly disallowed.
5. **Database Invariants:** Append-only ledgers and immutable transaction rows are guarded at the database level with PostgreSQL triggers and deferred constraint triggers.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in RelayForge, please report it responsibly:

- **Email:** `alhasanwasti2005@gmail.com`
- Please provide a detailed description of the vulnerability, reproduction steps, and potential impact.
- We will acknowledge receipt of your report within 48 hours and provide status updates as we work on a fix.
- Do not disclose the issue publicly until a patch has been merged and released.
