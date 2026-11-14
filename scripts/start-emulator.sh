#!/usr/bin/env bash
# Boots an Android emulator on a GitHub-hosted runner for the APK device proof.
# Runs on the runner only, never on our server.
#
# We start the emulator ourselves instead of through android-emulator-runner so that a
# failed boot prints the emulator's own log. The previous CI runs only ever said
# "Timeout waiting for emulator to boot" and never said why.
set -euo pipefail

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:?ANDROID_HOME is not set}}"
API="${API_LEVEL:-34}"
GPU="${EMULATOR_GPU:-swiftshader}"
AVD=ci-phone
# Inside the checkout on purpose: upload-artifact cannot scope an absolute path outside the
# workspace, so the log has to live somewhere it can pick up without scanning the filesystem.
LOG="${EMULATOR_LOG:-proof/emulator.log}"
mkdir -p "$(dirname "$LOG")"
WAIT_SECONDS="${EMULATOR_BOOT_TIMEOUT:-900}"

export ANDROID_SDK_ROOT="$SDK"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
mkdir -p "$ANDROID_AVD_HOME"

image="system-images;android-${API};google_apis;x86_64"
yes | sdkmanager --licenses > /dev/null || true
# An older image with the newest emulator is what hangs: take the matching image, the
# current platform and the current emulator from the same channel.
sdkmanager "platform-tools" "platforms;android-${API}" "emulator" "$image" > /dev/null

# Fresh AVD every run: a cached one from the runner image may point at a missing image.
echo "no" | avdmanager create avd -n "$AVD" -k "$image" --force -d pixel_5

echo "== hardware acceleration =="
ls -l /dev/kvm || true
qemu="$SDK/emulator/qemu/linux-x86_64/qemu-system-x86_64"
if [ -x "$qemu" ]; then
  missing="$(ldd "$qemu" | grep 'not found' || true)"
  if [ -n "$missing" ]; then
    echo "::error::qemu is missing shared libraries"
    echo "$missing"
    exit 1
  fi
fi
"$SDK/emulator/emulator" -accel-check || true
# No `| head` here: under `set -o pipefail` the early close sends the emulator SIGPIPE
# and fails the step before the boot ever starts.
"$SDK/emulator/emulator" -version 2>&1 | sed -n '1,2p' || true
echo "== emulator: API ${API}, image ${image}, gpu ${GPU} =="

"$SDK/emulator/emulator" -avd "$AVD" \
  -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu "$GPU" -camera-back none -camera-front none \
  > "$LOG" 2>&1 &
emulator_pid=$!

fail() {
  echo "::error::$1"
  echo "== the last 80 lines of the emulator log =="
  tail -80 "$LOG" || true
  kill "$emulator_pid" 2>/dev/null || true
  exit 1
}

deadline=$((SECONDS + WAIT_SECONDS))
booted=""
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    fail "the emulator process exited before the device booted"
  fi
  booted="$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [ "$booted" = "1" ]; then
    break
  fi
  sleep 5
done

if [ "$booted" != "1" ]; then
  fail "the emulator did not finish booting within ${WAIT_SECONDS}s"
fi

echo "the emulator booted after ${SECONDS}s"
adb devices -l
adb -s emulator-5554 shell getprop ro.build.version.release
