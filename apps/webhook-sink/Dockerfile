# syntax=docker/dockerfile:1
# Build context: repository root.

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
# Registry fetches are retried patiently so that slow networks do not fail the build.
ARG PNPM_FETCH_TIMEOUT_MS=300000
ARG PNPM_FETCH_RETRIES=5
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    pnpm_config_cache_dir=/pnpm/cache \
    pnpm_config_fetch_timeout=${PNPM_FETCH_TIMEOUT_MS} \
    pnpm_config_fetch_retries=${PNPM_FETCH_RETRIES}
RUN corepack enable
WORKDIR /repo
# Every workspace manifest is copied so the frozen lockfile check sees the whole workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/webhook-sink/package.json apps/webhook-sink/
RUN --mount=type=cache,id=relayforge-pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=relayforge-pnpm-cache,target=/pnpm/cache \
    pnpm install --frozen-lockfile --filter @relayforge/webhook-sink
COPY apps/webhook-sink apps/webhook-sink
RUN pnpm --filter @relayforge/webhook-sink build

# The sink has no runtime dependencies: compiled JavaScript on plain Node.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/webhook-sink/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
