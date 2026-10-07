# =====================================================================================
# Web image (Next.js standalone)
# =====================================================================================

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
# npm ci validates and links every declared workspace from the lockfile, even
# when the web app imports only a subset. Keep the manifest layer in sync with
# the monorepo, matching the backend image's deterministic install strategy.
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

FROM deps AS build
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_PLATFORM_SUBDOMAIN=platform
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_PLATFORM_SUBDOMAIN=${NEXT_PUBLIC_PLATFORM_SUBDOMAIN}
# The web app transpiles workspace packages from source, so only the packages it
# imports need to exist as sources - no pre-build step is required.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @fee/web

# Local Compose uses Next's own dev server. Compose Watch syncs source changes
# into this target so its built-in Fast Refresh remains available in containers.
FROM deps AS development
WORKDIR /app
COPY . .
ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@fee/web"]

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ARG NEXT_PUBLIC_PLATFORM_SUBDOMAIN=platform
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    NEXT_PUBLIC_PLATFORM_SUBDOMAIN=${NEXT_PUBLIC_PLATFORM_SUBDOMAIN}

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# Next's standalone output contains only the files this application actually uses.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
