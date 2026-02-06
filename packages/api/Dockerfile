# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy all package.json files for dependency installation
COPY packages/shared/package.json ./packages/shared/
COPY packages/event-sourcing/package.json ./packages/event-sourcing/
COPY packages/api/package.json ./packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/event-sourcing ./packages/event-sourcing
COPY packages/api ./packages/api

# Build all packages in order
RUN pnpm --filter @screeem/shared build || true
RUN pnpm --filter @screeem/event-sourcing build || true
RUN pnpm --filter @screeem/api build

# Production stage
FROM node:20-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files
COPY packages/shared/package.json ./packages/shared/
COPY packages/event-sourcing/package.json ./packages/event-sourcing/
COPY packages/api/package.json ./packages/api/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/event-sourcing/dist ./packages/event-sourcing/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

# Copy migrations
COPY packages/api/migrations ./packages/api/migrations

# Set working directory to api package
WORKDIR /app/packages/api

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
