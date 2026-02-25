FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --filter @ai-email/api...

FROM deps AS build

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

RUN pnpm --filter @ai-email/api build \
  && pnpm --filter @ai-email/shared exec tsc -p tsconfig.json --noEmit false --outDir dist --rootDir src

RUN sed -i 's|\"\\.\": \"\\./src/index.ts\"|\".\": \"./dist/index.js\"|' ./packages/shared/package.json

FROM build AS deploy

RUN pnpm --filter @ai-email/api deploy --legacy --prod /out

FROM base AS runner

ENV NODE_ENV="production"
ENV HOST="0.0.0.0"
ENV PORT="8080"

WORKDIR /app

COPY --from=deploy /out ./

EXPOSE 8080

CMD ["node", "dist/index.js"]
