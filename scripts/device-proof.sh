#!/usr/bin/env bash
# Runs inside the android-emulator-runner step on a GitHub-hosted runner: starts the Worker
# on the runner host, installs the APK in the emulator and drives it. Never runs on our server.
set -euo pipefail

npx wrangler d1 migrations apply calorie-mcp-proto --local
npx wrangler dev --ip 0.0.0.0 --port 8788 --var PUBLIC_URL:http://127.0.0.1:8788 --var SIGNUP_OPEN:1 --var AUTH_SIGNING_SECRET:ci-only-not-a-production-secret > /tmp/worker.log 2>&1 &
worker=$!
trap 'kill "$worker" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8788/health > /dev/null; then
    break
  fi
  sleep 1
done
if ! curl -sf http://127.0.0.1:8788/health > /dev/null; then
  echo "the Worker did not start"
  cat /tmp/worker.log
  exit 1
fi

adb wait-for-device
# The emulator's first boot leaves the device briefly offline; wait for the package manager.
for _ in $(seq 1 60); do
  if adb shell pm path android > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.calorie.tracker/.MainActivity
sleep 12
node scripts/drive-device.mjs
