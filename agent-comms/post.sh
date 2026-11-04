#!/usr/bin/env bash
# Usage: agent-comms/post.sh <from> <to> <type> <slug> [re] < body
#   echo "Can I take src/api?" | agent-comms/post.sh addybrm-claude all question api-ownership
set -euo pipefail
[ $# -ge 4 ] || { sed -n '2,3p' "$0"; exit 1; }
from=$1 to=$2 type=$3 slug=$4 re=${5:-}
dir="$(cd "$(dirname "$0")" && pwd)/messages"
file="$dir/$(date -u +%Y%m%dT%H%M%SZ)-$from-$slug.md"
{
  printf -- '---\nfrom: %s\nto: %s\ntype: %s\nre: %s\n---\n\n' "$from" "$to" "$type" "$re"
  cat
} > "$file"
echo "$file"
