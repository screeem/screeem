#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
supabase_cli="$repo_dir/node_modules/.bin/supabase"
docker_env="$repo_dir/supabase/.env.docker.local"
web_env="$repo_dir/packages/web/.env.local"
action=${1:-up}

cd "$repo_dir"

require_local_tools() {
  if [ ! -x "$supabase_cli" ]; then
    echo "Supabase CLI is missing; run make setup once while online." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker Desktop is not running or is unavailable." >&2
    exit 1
  fi
}

write_local_env() {
  umask 077
  "$supabase_cli" status -o env > "$docker_env"
  chmod 600 "$docker_env"

  set -a
  # shellcheck disable=SC1090
  . "$docker_env"
  set +a

  env_tmp=$(mktemp "${TMPDIR:-/tmp}/screeem-web-env.XXXXXX")
  {
    printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n' "$API_URL"
    printf 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\n' "$PUBLISHABLE_KEY"
    printf 'NEXT_PUBLIC_SITE_URL=http://localhost:3000\n'
    printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SERVICE_ROLE_KEY"
    printf 'DATABASE_URL=%s\n' "$DB_URL"
    printf 'TURNSTILE_SECRET_KEY=\n'
    printf 'CRON_SECRET=local-routing-actions\n'
  } > "$env_tmp"
  mv "$env_tmp" "$web_env"
}

start_supabase() {
  require_local_tools
  "$supabase_cli" start
  "$supabase_cli" migration up --local
  write_local_env
}

case "$action" in
  infra)
    start_supabase
    ;;
  infra-down)
    require_local_tools
    "$supabase_cli" stop
    ;;
  status)
    require_local_tools
    "$supabase_cli" status
    ;;
  reset)
    start_supabase
    "$supabase_cli" db reset
    write_local_env
    ;;
  build)
    start_supabase
    docker compose --env-file "$docker_env" --profile test build web test
    ;;
  up)
    start_supabase
    docker compose --env-file "$docker_env" up --build web
    ;;
  up-cached)
    start_supabase
    docker compose --env-file "$docker_env" up --no-build web
    ;;
  test)
    start_supabase
    "$supabase_cli" db reset
    "$supabase_cli" test db
    write_local_env
    docker compose --env-file "$docker_env" --profile test run --rm --build test
    ;;
  test-cached)
    start_supabase
    "$supabase_cli" db reset
    "$supabase_cli" test db
    write_local_env
    docker compose --env-file "$docker_env" --profile test run --rm --no-deps test
    ;;
  down)
    require_local_tools
    docker compose --env-file "$docker_env" down 2>/dev/null || true
    "$supabase_cli" stop
    ;;
  *)
    echo "Usage: $0 {infra|infra-down|status|reset|build|up|up-cached|test|test-cached|down}" >&2
    exit 2
    ;;
esac
