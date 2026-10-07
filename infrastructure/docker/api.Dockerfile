# =====================================================================================
# API / worker image
# =====================================================================================
#
# One Dockerfile produces both backend images, selected by APP. They share every
# dependency and differ only in entrypoint, so a single layer cache serves both and
# they cannot drift apart.
#
#   docker build -f infrastructure/docker/api.Dockerfile --target runtime \
#     --build-arg APP=api -t fee-api .
#   docker build -f infrastructure/docker/api.Dockerfile --target production-runtime \
#     --build-arg APP=api -t fee-api:production .
#
# Notes:
#   - Prisma 7 uses a driver adapter and the JavaScript query compiler, so no native
#     engine binary is needed and `node:22-alpine` is sufficient.
#   - The generated Prisma client is build output, not source: it is produced inside
#     the image so the host and the container can never disagree about the schema.
#   - `runtime` is the local-development/operations image (includes tsx and Prisma CLI).
#   - The default `production-runtime` target contains only production dependencies.
# =====================================================================================

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
# Stage 1: dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Build tooling for any package needing a native step, plus openssl for Prisma.
RUN apk add --no-cache libc6-compat openssl python3 make g++

# Manifests first: this layer is invalidated only by a dependency change, not by a
# code change, which keeps rebuilds fast.
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages/money/package.json packages/money/
COPY packages/types/package.json packages/types/
COPY packages/dates/package.json packages/dates/
COPY packages/validation/package.json packages/validation/
COPY packages/logger/package.json packages/logger/
COPY packages/config/package.json packages/config/
COPY packages/fee-engine/package.json packages/fee-engine/
COPY packages/payment-contracts/package.json packages/payment-contracts/
COPY packages/database/package.json packages/database/
COPY packages/notifications/package.json packages/notifications/
COPY packages/receipts/package.json packages/receipts/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/web-preview/package.json apps/web-preview/

RUN npm ci --include=dev --ignore-scripts

# Keep one deterministic install/build graph. The final production target copies
# only this pruned dependency tree; it does not inherit the development layer.
FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 2: build
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

# Client generation evaluates prisma.config.ts but does not connect to a database.
# It uses no database credential, so clean image builds do not depend on the host's
# .env file or production secrets.

COPY . .

# The schema must exist before generating; `prisma generate` writes the client into
# packages/database/src/generated, which the next step compiles.
RUN npx prisma generate

# Libraries build before the apps that consume their dist output.
RUN npm run build --workspace @fee/money \
 && npm run build --workspace @fee/types \
 && npm run build --workspace @fee/dates \
 && npm run build --workspace @fee/validation \
 && npm run build --workspace @fee/logger \
 && npm run build --workspace @fee/config \
 && npm run build --workspace @fee/fee-engine \
 && npm run build --workspace @fee/payment-contracts \
 && npm run build --workspace @fee/database \
 && npm run build --workspace @fee/notifications \
 && npm run build --workspace @fee/receipts \
 && npm run build --workspace @fee/api \
 && npm run build --workspace @fee/worker

# ---------------------------------------------------------------------------
# Stage 3: shared runtime files
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime-base
WORKDIR /app

ARG APP=api
ENV APP=${APP} \
    NODE_ENV=production

RUN apk add --no-cache openssl tini \
 && addgroup -S -g 1001 fee \
 && adduser -S -u 1001 -G fee fee \
 && mkdir -p /app/.tmp \
 && chown fee:fee /app/.tmp

COPY --from=build --chown=fee:fee /app/package.json ./package.json
COPY --from=build --chown=fee:fee /app/packages ./packages
COPY --from=build --chown=fee:fee /app/apps/api ./apps/api
COPY --from=build --chown=fee:fee /app/apps/worker ./apps/worker

USER fee

# tini reaps zombies and forwards SIGTERM to the app process so in-flight work can
# finish through each app's shutdown lifecycle.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "if [ \"$APP\" = \"worker\" ]; then exec node apps/worker/dist/main.js; else exec node apps/api/dist/main.js; fi"]

# The worker has no HTTP listener, so its liveness probe checks for its process;
# the API probe uses the version-independent health route. The API port is declared
# in Compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "if(process.env.APP==='worker'){const fs=require('node:fs');const alive=fs.readdirSync('/proc').some(pid=>/^\\d+$/.test(pid)&&Number(pid)!==process.pid&&(()=>{try{return fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes('apps/worker/dist/main.js')}catch{return false}})());process.exit(alive?0:1)}require('http').get('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

# Local Compose and one-shot database operations need development CLIs such as
# tsx and Prisma. This target is explicit so it is never the production default.
FROM runtime-base AS runtime
COPY --from=build --chown=fee:fee /app/node_modules ./node_modules
COPY --from=build --chown=fee:fee /app/prisma ./prisma
COPY --from=build --chown=fee:fee /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=fee:fee /app/scripts ./scripts

# Production API/worker containers use the exact same compiled artifacts with a
# pruned dependency tree. This is the Dockerfile's default target.
FROM runtime-base AS production-runtime
COPY --from=production-deps --chown=fee:fee /app/node_modules ./node_modules
