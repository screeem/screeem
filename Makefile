.DEFAULT_GOAL := help

PNPM ?= pnpm
PLAYGROUND_URL := http://localhost:3000/_dev/form-builder

.PHONY: help setup offline-check packages playground dev infra-up infra-down infra-status db-reset test docker-build docker-up docker-test docker-down

help: ## Show local development commands.
	@awk 'BEGIN {FS = ":.*## "; printf "Screeem local development\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## One-time online setup: cache packages, Supabase images, and app images.
	$(PNPM) install --frozen-lockfile
	sh scripts/docker-local.sh build
	@printf '\nSetup complete. Future playground and dev runs can use the local caches.\n'

offline-check: ## Prove pnpm and app images are available without downloading anything.
	$(PNPM) install --offline --frozen-lockfile
	docker image inspect screeem-web:local screeem-test:local >/dev/null
	sh scripts/docker-local.sh infra
	@printf '\nOffline prerequisites are present.\n'

packages:
	@test -x packages/web/node_modules/.bin/next || { printf 'Dependencies are missing; run make setup once while online.\n' >&2; exit 1; }
	$(PNPM) --filter @screeem/routing build
	$(PNPM) --filter @screeem/forms build
	$(PNPM) --filter @screeem/forms-react build

playground: packages ## Run the development-only visual form and routing playground.
	@printf '\nOpen $(PLAYGROUND_URL)\n\n'
	$(PNPM) --filter @screeem/web dev --hostname 127.0.0.1

dev: infra-up packages ## Run Dockerized local services and the Next.js development server.
	@printf '\nApp:        http://localhost:3000\nPlayground: $(PLAYGROUND_URL)\nStudio:     http://127.0.0.1:54323\n\n'
	$(PNPM) --filter @screeem/web dev --hostname 127.0.0.1

infra-up: ## Start Dockerized Supabase, apply pending migrations, and write local env.
	sh scripts/docker-local.sh infra

infra-down: ## Stop and remove the local Supabase containers (cached images remain).
	sh scripts/docker-local.sh infra-down

infra-status: ## Show local Supabase service URLs and status.
	sh scripts/docker-local.sh status

db-reset: ## Reset the local database and seed it from current migrations.
	sh scripts/docker-local.sh reset

test: infra-up ## Run routing, forms, React, web, and local database tests.
	$(PNPM) --filter @screeem/routing test
	$(PNPM) --filter @screeem/forms test
	$(PNPM) --filter @screeem/forms-react test
	$(PNPM) --filter @screeem/web test
	$(PNPM) supabase test db

docker-build: ## Build and cache the production and test app images.
	sh scripts/docker-local.sh build

docker-up: ## Run the cached production image against local Supabase.
	sh scripts/docker-local.sh up-cached

docker-test: ## Run database and application tests using cached images.
	sh scripts/docker-local.sh test-cached

docker-down: ## Stop the production app and local Supabase stack.
	sh scripts/docker-local.sh down
