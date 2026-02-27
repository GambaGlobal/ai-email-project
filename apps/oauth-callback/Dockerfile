FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/oauth-callback/package.json apps/oauth-callback/package.json

RUN pnpm install --frozen-lockfile --filter @ai-email/oauth-callback...

FROM deps AS build

COPY apps/oauth-callback ./apps/oauth-callback

RUN pnpm --filter @ai-email/oauth-callback build

FROM build AS deploy

RUN pnpm --filter @ai-email/oauth-callback deploy --legacy --prod /out

FROM base AS runner

ENV NODE_ENV="production"
ENV HOST="0.0.0.0"
ENV PORT="8080"

WORKDIR /app

COPY --from=deploy /out ./

EXPOSE 8080

CMD ["node", "dist/index.js"]
