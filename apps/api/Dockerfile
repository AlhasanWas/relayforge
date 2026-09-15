# syntax=docker/dockerfile:1
# Build context: repository root (the API depends on the shared workspace package).

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
# Registry fetches are retried patiently so that slow networks do not fail the build.
ARG PNPM_FETCH_TIMEOUT_MS=300000
ARG PNPM_FETCH_RETRIES=5
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    pnpm_config_cache_dir=/pnpm/cache \
    pnpm_config_fetch_timeout=${PNPM_FETCH_TIMEOUT_MS} \
    pnpm_config_fetch_retries=${PNPM_FETCH_RETRIES}
RUN corepack enable && mkdir -p "$COREPACK_HOME" && chmod 0777 "$COREPACK_HOME"
WORKDIR /repo

# ---- Dependencies (cached until a manifest or the lockfile changes) ----------
FROM base AS dependencies
# Every workspace manifest is copied so the frozen lockfile check sees the whole workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/webhook-sink/package.json apps/webhook-sink/
RUN --mount=type=cache,id=relayforge-pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=relayforge-pnpm-cache,target=/pnpm/cache \
    pnpm install --frozen-lockfile --filter "@relayforge/api..."

# ---- Build ---------------------------------------------------------------------
FROM dependencies AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @relayforge/shared build \
 && pnpm --filter @relayforge/api build \
 && chmod -R a+rX /repo

# ---- Migrations and seed (one-shot; needs the Prisma CLI and tsx) ---------------
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed"]

# ---- Production dependencies only ----------------------------------------------
FROM build AS deploy
RUN --mount=type=cache,id=relayforge-pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=relayforge-pnpm-cache,target=/pnpm/cache \
    pnpm --filter @relayforge/api deploy --prod /prod/api

# ---- Runtime: API (default) or worker (command: node dist/worker.js) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deploy --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=deploy --chown=node:node /prod/api/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
