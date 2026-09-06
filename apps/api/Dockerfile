FROM node:22.20.0-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.js ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter @kagaz/api...

COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
RUN pnpm --filter @kagaz/api... build && pnpm --filter @kagaz/api deploy --prod /prod/api

FROM node:22.20.0-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /prod/api ./

EXPOSE 4000
CMD ["node", "dist/index.js"]
