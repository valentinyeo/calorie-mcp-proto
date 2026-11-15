#!/usr/bin/env bash
# Answers one question for the unprivileged app user: can it reach and read these paths?
#
#   sudo -u pstackapp verifier/reach.sh <dir-or-file>...
#
# Run it AS the app user, so the answer comes from the same kernel checks that will run later.
# A directory on the way down that the app user cannot traverse makes every file below it
# unreachable, even when the app user owns those files, and bash then only says
# "bash: /path: Permission denied" with nothing about which directory did it. The first real
# run spent ten minutes on exactly that.
#
# Prints one line per path: "OK <path>" or
# "FAILED <path>: <component> is not traversable by <user> (mode <mode> <owner>)".
# Exits 1 when any path is unreachable.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: verifier/reach.sh <path>..." >&2
  exit 2
fi

user=$(id -un)
status=0

for target in "$@"; do
  resolved=$(readlink -f -- "$target" 2>/dev/null) || resolved=$target

  # Root first: the kernel checks every directory on the way in, and the first one that says no
  # is the answer.
  chain=()
  path=$resolved
  while :; do
    chain=("$path" "${chain[@]}")
    [ "$path" = "/" ] && break
    path=$(dirname -- "$path")
  done

  blocked=""
  why=""
  index=0
  total=${#chain[@]}
  for path in "${chain[@]}"; do
    index=$((index + 1))
    if [ "$index" -eq "$total" ] && [ ! -d "$path" ]; then
      if [ ! -r "$path" ]; then
        blocked=$path
        why="not readable by $user"
      fi
    elif [ ! -x "$path" ]; then
      blocked=$path
      why="not traversable by $user"
    fi
    [ -n "$blocked" ] && break
  done

  if [ -n "$blocked" ]; then
    mode=$(stat -c '%a %U' -- "$blocked" 2>/dev/null) || mode="mode and owner unknown"
    echo "FAILED $resolved: $blocked is $why (mode $mode)"
    status=1
  else
    echo "OK $resolved"
  fi
done

exit "$status"
