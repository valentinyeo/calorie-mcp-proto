#!/usr/bin/env bash
# Starts one checkout of Calorie Tracker locally and fully offline, waits until it is ready,
# and prints the two URLs the verifier drives.
#
#   verifier/start-app.sh <dir> <port>
#
# <dir> is a checkout of this repo, <port> is the Worker API port. The local D1 database
# lives in <dir>/.wrangler, the web app is built from the same checkout into <dir>/dist-app
# and served under http://localhost:5173/<basename of dir>/ by verifier/app-server.mjs, so
# both checkouts keep the app's real origin (APP_ORIGINS in src/auth.ts) and its real CORS.
# Nothing here talks to production: no wrangler deploy, no remote database, no live service.
# The seed data is invented (verifier/seed.mjs).
#
# The app is installed, built and run with every model login removed from the environment,
# so a pull request's own code cannot read one from its own environment or from /proc.
set -euo pipefail

dir=${1:-}
port=${2:-}
if [ -z "$dir" ] || [ -z "$port" ]; then
  echo "usage: verifier/start-app.sh <dir> <port>" >&2
  exit 2
fi

here=$(cd "$(dirname "$0")" && pwd)
dir=$(cd "$dir" && pwd)
slug=${PSTACK_SLUG:-$(basename "$dir")}
app_port=${PSTACK_APP_PORT:-5173}
mounts=${PSTACK_MOUNTS:-/tmp/pstack-app-mounts}
run_dir=$dir/.verifier-run
mkdir -p "$run_dir" "$mounts"

unset CLAUDE_CODE_OAUTH_TOKEN DEEPSEEK_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY \
  ANTHROPIC_BASE_URL ANTHROPIC_MODEL OPENAI_API_KEY GH_TOKEN GITHUB_TOKEN
export CI=1
export WRANGLER_SEND_METRICS=false
export WRANGLER_SKIP_UPDATE_CHECK=1

worker_pid=""
app_server_pid=""

cleanup() {
  if [ -n "$app_server_pid" ]; then kill "$app_server_pid" 2>/dev/null || true; fi
  if [ -n "$worker_pid" ]; then kill "$worker_pid" 2>/dev/null || true; fi
}
on_error() {
  echo "FAILED start-app.sh on $dir (see $run_dir)" >&2
  tail -20 "$run_dir/worker.log" 2>/dev/null >&2 || true
  tail -20 "$run_dir/build.log" 2>/dev/null >&2 || true
  tail -20 "$run_dir/app-server.log" 2>/dev/null >&2 || true
  cleanup
  exit 1
}
trap on_error ERR

wait_for() {
  # wait_for <url> <label>: poll one local URL for up to 180 seconds.
  node --input-type=module -e '
    const [url, label] = process.argv.slice(1);
    for (let i = 0; i < 180; i++) {
      try { const r = await fetch(url); if (r.ok) process.exit(0); } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.error("timed out waiting for " + label + " at " + url);
    process.exit(1);
  ' "$1" "$2"
}

echo "step: install declared dependencies in $dir"
cd "$dir"
if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund > "$run_dir/install.log" 2>&1
fi

echo "step: apply the local database migrations"
npx --no-install wrangler d1 migrations apply calorie-mcp-proto --local > "$run_dir/migrate.log" 2>&1

echo "step: start the Worker on 127.0.0.1:$port"
npx --no-install wrangler dev --ip 127.0.0.1 --port "$port" \
  --var "PUBLIC_URL:http://127.0.0.1:$port" \
  --var "SIGNUP_OPEN:1" \
  --var "AUTH_SIGNING_SECRET:pstack-verifier-local-only" > "$run_dir/worker.log" 2>&1 &
worker_pid=$!
wait_for "http://127.0.0.1:$port/health" "the Worker health check"

echo "step: build the web app against 127.0.0.1:$port"
VITE_API_BASE="http://127.0.0.1:$port" npx --no-install vite build --config app/vite.config.ts > "$run_dir/build.log" 2>&1

echo "step: mount the built app at /$slug/"
printf '{"slug":"%s","dir":"%s"}\n' "$slug" "$dir/dist-app" > "$mounts/$slug.json.tmp"
mv "$mounts/$slug.json.tmp" "$mounts/$slug.json"

if ! node --input-type=module -e 'try { process.exit((await fetch(process.argv[1])).ok ? 0 : 1) } catch { process.exit(1) }' \
  "http://127.0.0.1:$app_port/__pstack"; then
  echo "step: start the shared app server on 127.0.0.1:$app_port"
  node "$here/app-server.mjs" "$app_port" > "$run_dir/app-server.log" 2>&1 &
  app_server_pid=$!
  echo "$app_server_pid" > "$run_dir/app-server.pid"
fi
wait_for "http://127.0.0.1:$app_port/__pstack" "the shared app server"
wait_for "http://127.0.0.1:$app_port/$slug/" "the built app under /$slug/"

echo "step: seed invented data"
node "$here/seed.mjs" "http://127.0.0.1:$port"

echo "READY $slug"
echo "API_URL=http://127.0.0.1:$port"
echo "APP_URL=http://localhost:$app_port/$slug/"
echo "SEED_EMAIL=pstack-verifier@example.com"
echo "SEED_PASSWORD=pstack-verifier-local-only"
