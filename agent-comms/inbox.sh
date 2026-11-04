#!/usr/bin/env bash
# Usage: agent-comms/inbox.sh <agent-name> [since-YYYYMMDD]
# Prints messages addressed to <agent-name> or "all", oldest first.
set -euo pipefail
[ $# -ge 1 ] || { sed -n '2,3p' "$0"; exit 1; }
me=$1 since=${2:-00000000}
dir="$(cd "$(dirname "$0")" && pwd)/messages"
for f in "$dir"/*.md; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  [[ "$name" < "$since" ]] && continue
  to=$(awk '/^to:/{sub(/^to:[ ]*/,""); sub(/[ ]*#.*/,""); print; exit}' "$f")
  if [[ ",${to// /}," == *",$me,"* || ",${to// /}," == *",all,"* ]]; then
    printf '\n===== %s =====\n' "$name"; cat "$f"
  fi
done
