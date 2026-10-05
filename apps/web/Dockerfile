# Bystro web (Next.js). Build context: the repository root.
#   docker build -f apps/web/Dockerfile -t bystro-web .

FROM node:24-bookworm-slim AS base
RUN npm install --global pnpm@12.9.1
WORKDIR /repo

# ---- dependencies: cached until a manifest or the lockfile changes ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/observability/package.json packages/observability/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .

# Public by design (it ends up in the browser bundle), so a build argument is fine.
ARG NEXT_PUBLIC_SENTRY_DSN=""
# Optional: upload source maps to Sentry. Without all three nothing is uploaded.
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT_STANDALONE=1 \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

# The auth token is passed only to this one command, so it is not stored in an image layer's
# environment. No runtime secrets are needed to build (see apps/web/src/server/auth.ts).
RUN SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN SENTRY_ORG=$SENTRY_ORG SENTRY_PROJECT=$SENTRY_PROJECT \
    pnpm --filter @bystro/web build \
 && pnpm --filter @bystro/db build:migrate

# ---- runtime: only the traced server, static assets and the migration bundle ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app

COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/packages/db/dist/migrate.cjs ./migrate.cjs
COPY --from=build --chown=node:node /repo/packages/db/migrations ./migrations

USER node
EXPOSE 3000
# Migrations run before each deploy: `node migrate.cjs` (see apps/web/railway.json).
CMD ["node", "apps/web/server.js"]
