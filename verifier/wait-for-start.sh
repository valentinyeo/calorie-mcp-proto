#!/usr/bin/env bash
# Waits until every start log says READY or FAILED, stops early when every starter has died
# without saying either, and stops at the deadline.
#
#   verifier/wait-for-start.sh <deadline-seconds> <label> <log> <pid> [<label> <log> <pid> ...]
#
# Exit 0 when every side settled, 1 when one did not, with the reason for each unsettled side on
# stderr. Dead starters end the wait at once: in the first real run both start scripts died in
# the first second with "Permission denied", no log ever got READY or FAILED, and the job slept
# out its whole ten minute deadline for nothing.
set -uo pipefail

usage() {
  echo "usage: verifier/wait-for-start.sh <deadline-seconds> <label> <log> <pid> [...]" >&2
  exit 2
}

[ "$#" -ge 4 ] || usage
deadline_seconds=$1
shift
case $deadline_seconds in
  '' | *[!0-9]*) usage ;;
esac

labels=()
logs=()
pids=()
while [ "$#" -gt 0 ]; do
  [ "$#" -ge 3 ] || usage
  labels+=("$1")
  logs+=("$2")
  pids+=("$3")
  shift 3
done

settled() {
  grep -qE '^(READY|FAILED) ' "$1" 2>/dev/null
}

report() {
  for index in "${!logs[@]}"; do
    settled "${logs[$index]}" || echo "GAVE UP ${labels[$index]}: $1 (${logs[$index]})" >&2
  done
}

deadline=$((SECONDS + deadline_seconds))
while :; do
  outstanding=0
  for index in "${!logs[@]}"; do
    settled "${logs[$index]}" || outstanding=$((outstanding + 1))
  done
  [ "$outstanding" -eq 0 ] && exit 0

  alive=0
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then alive=$((alive + 1)); fi
  done
  if [ "$alive" -eq 0 ]; then
    report "its start script exited without READY or FAILED"
    exit 1
  fi

  if [ "$SECONDS" -ge "$deadline" ]; then
    report "nothing settled before the ${deadline_seconds}s deadline"
    exit 1
  fi
  sleep 2
done
