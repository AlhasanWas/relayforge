# Contributing to RelayForge

Thank you for your interest in contributing to RelayForge!

RelayForge is an enterprise-grade platform where correctness, idempotency, and financial invariants are paramount. Contributions must adhere to the engineering standards detailed below.

---

## 1. Architectural Philosophy

Before contributing, read the core architecture and decision records:

- [Architecture Overview](docs/architecture.md)
- [Reliability Guarantees](docs/reliability.md)
- [Security Model](docs/security.md)
- [Architecture Decision Records (ADRs)](docs/decisions/)

### Invariant Principles

1. **PostgreSQL is the single source of truth.** Redis is an ephemeral execution transport. Any work committed to the database must survive total Redis cluster restarts without loss.
2. **Never commit unbalanced ledger journals.** Double-entry journals must balance ($\sum \text{Debits} = \sum \text{Credits}$) with at least two postings. This is enforced by database constraint triggers at `COMMIT`.
3. **Delivery is at-least-once.** Never assume HTTP calls are exactly-once. Webhooks dispatched by RelayForge carry a stable `webhook-id` header so downstream receivers can deduplicate.
4. **No network I/O inside database transactions.** External network requests (e.g. dispatching webhooks to customer endpoints) must execute outside database transactions to avoid connection pool exhaustion.

---

## 2. Local Development Setup

### Prerequisites

- **Node.js**: `>= 24.11.0`
- **pnpm**: `11.26.0` (via Corepack or global install)
- **Docker & Docker Compose** (for PostgreSQL 17 and Redis 7.4)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/AlhasanWas/relayforge.git
cd relayforge

# Copy development environment
cp .env.example .env

# Install dependencies
pnpm install

# Start Postgres and Redis services
docker compose up -d postgres redis

# Run migrations and seed data
pnpm --filter @relayforge/api db:migrate
pnpm --filter @relayforge/api db:seed

# Build packages
pnpm build
```

---

## 3. Adding a New Payment Provider Adapter

To support a new payment provider (e.g., Stripe, Adyen, PayPal):

1. Create a schema definition in `packages/shared/src/providers/<provider>.ts`.
2. Implement the `ProviderAdapter` interface in `apps/api/src/providers/<provider>.adapter.ts`.
3. Register the adapter in `ProviderAdapterRegistry` (`apps/api/src/providers/provider-adapter.registry.ts`).
4. Add comprehensive unit tests in `apps/api/src/providers/<provider>.adapter.spec.ts`.

---

## 4. Quality Verification & Testing

Every PR must pass all quality gates locally before submission:

```bash
# Format check
pnpm format:check

# ESLint analysis
pnpm lint

# TypeScript strict typecheck across monorepo
pnpm typecheck

# Unit tests
pnpm test

# Full integration test suite (requires running Postgres and Redis)
pnpm test:integration
```

---

## 5. Commit & Pull Request Guidelines

### Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat(api): ...`
- `fix(ledger): ...`
- `docs: ...`
- `test(ingestion): ...`
- `chore(deps): ...`

### Pull Request Checklist

- [ ] Code follows existing architectural patterns and Clean Architecture boundaries.
- [ ] Tests added for new functionality (especially concurrent failure scenarios and edge cases).
- [ ] Database migrations include corresponding trigger tests if database invariants are touched.
- [ ] Formatting (`pnpm format`), linting (`pnpm lint`), and typecheck (`pnpm typecheck`) pass cleanly.
