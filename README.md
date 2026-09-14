# RelayForge

Webhook ingestion, transaction processing, and reliable webhook delivery.

RelayForge receives signed webhooks from payment providers, processes them
idempotently into a double-entry ledger, and delivers signed webhooks to customer
endpoints with retries, dead-lettering, and safe replay.

> **Status:** under active development. The architecture, domain invariants and
> phased plan are in [`docs/implementation-plan.md`](docs/implementation-plan.md).
> This README will document setup, the demo, and the API once those phases land.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- pnpm via Corepack: `corepack enable`
- Docker (PostgreSQL and Redis for local development and integration tests)

## Quality checks

```bash
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## License

[MIT](LICENSE)
