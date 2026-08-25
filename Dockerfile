# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/billing/package.json packages/billing/package.json
COPY packages/blog_components/package.json packages/blog_components/package.json
COPY packages/forms/package.json packages/forms/package.json
COPY packages/forms-react/package.json packages/forms-react/package.json
COPY packages/mcp_post_preview/package.json packages/mcp_post_preview/package.json
COPY packages/object-storage/package.json packages/object-storage/package.json
COPY packages/routing/package.json packages/routing/package.json
COPY packages/sample_blog/package.json packages/sample_blog/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS source
COPY . .

FROM source AS test
ENV NODE_ENV=test
CMD ["sh", "-c", "pnpm --filter @screeem/billing build && pnpm --filter @screeem/routing build && pnpm --filter @screeem/forms build && pnpm --filter @screeem/forms-react build && pnpm --filter @screeem/object-storage build && pnpm --filter @screeem/billing test && pnpm --filter @screeem/routing test && pnpm --filter @screeem/forms test && pnpm --filter @screeem/forms-react test && pnpm --filter @screeem/object-storage test && pnpm --filter @screeem/web exec tsc --noEmit && pnpm --filter @screeem/web test && pnpm --filter @screeem/web test:forms-db"]

FROM source AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV SCREEEM_DOCKER_BUILD=1
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN pnpm --filter @screeem/billing build \
  && pnpm --filter @screeem/routing build \
  && pnpm --filter @screeem/forms build \
  && pnpm --filter @screeem/forms-react build \
  && pnpm --filter @screeem/object-storage build \
  && pnpm --filter @screeem/web build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/packages/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/packages/web/public ./packages/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "packages/web/server.js"]
