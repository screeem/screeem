#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
supabase_cli="$repo_dir/node_modules/.bin/supabase"
docker_env="$repo_dir/supabase/.env.docker.local"
action=${1:-up}

cd "$repo_dir"

start_supabase() {
  "$supabase_cli" start
  "$supabase_cli" status -o env > "$docker_env"
}

case "$action" in
  up)
    start_supabase
    docker compose --env-file "$docker_env" up --build web
    ;;
  test)
    start_supabase
    "$supabase_cli" db reset
    "$supabase_cli" test db
    "$supabase_cli" status -o env > "$docker_env"
    docker compose --env-file "$docker_env" --profile test run --rm --build test
    ;;
  down)
    docker compose --env-file "$docker_env" down 2>/dev/null || true
    "$supabase_cli" stop
    ;;
  *)
    echo "Usage: $0 {up|test|down}" >&2
    exit 2
    ;;
esac
