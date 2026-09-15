# syntax=docker/dockerfile:1
# Build context: repository root (the dashboard depends on the shared workspace package).

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
# Registry fetches are retried patiently so that slow networks do not fail the build.
ARG PNPM_FETCH_TIMEOUT_MS=300000
ARG PNPM_FETCH_RETRIES=5
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    pnpm_config_cache_dir=/pnpm/cache \
    pnpm_config_fetch_timeout=${PNPM_FETCH_TIMEOUT_MS} \
    pnpm_config_fetch_retries=${PNPM_FETCH_RETRIES}
RUN corepack enable
WORKDIR /repo
# Every workspace manifest is copied so the frozen lockfile check sees the whole workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/webhook-sink/package.json apps/webhook-sink/
RUN --mount=type=cache,id=relayforge-pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=relayforge-pnpm-cache,target=/pnpm/cache \
    pnpm install --frozen-lockfile --filter "@relayforge/dashboard..."
COPY packages/shared packages/shared
COPY apps/dashboard apps/dashboard
RUN pnpm --filter @relayforge/shared build \
 && pnpm --filter @relayforge/dashboard build

# Next.js standalone output: a traced server with only the files it needs.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/dashboard/server.js"]
