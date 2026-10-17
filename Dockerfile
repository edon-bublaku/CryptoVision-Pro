# syntax=docker/dockerfile:1.7
# Multi-target image: `--target web` (Next.js standalone) and `--target worker` (BullMQ worker).
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/backtest/package.json packages/backtest/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/exchange/package.json packages/exchange/
COPY packages/indicators/package.json packages/indicators/
COPY packages/risk/package.json packages/risk/
COPY packages/server/package.json packages/server/
COPY packages/signals/package.json packages/signals/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @cv/web build

# ── Web: minimal standalone server ──────────────────────────────────
FROM node:${NODE_VERSION} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]

# ── Worker: runs TypeScript directly with tsx (same source as the web app) ──
FROM deps AS worker
COPY . .
ENV NODE_ENV=production CV_SERVICE=worker
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
CMD ["pnpm", "--filter", "@cv/worker", "start"]
