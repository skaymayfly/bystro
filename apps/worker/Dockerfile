# Bystro worker (BullMQ jobs from step 2.2 on). Build context: the repository root.
#   docker build -f apps/worker/Dockerfile -t bystro-worker .

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

# ---- build, then collect the worker with production dependencies only ----
FROM deps AS build
COPY . .
RUN pnpm --filter @bystro/worker build \
 && pnpm --filter @bystro/worker deploy --prod --legacy /out

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist

USER node
CMD ["node", "dist/index.js"]
