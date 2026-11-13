#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo"
set -- "${1:-120}"
if ! [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! awk -v seconds="$1" 'BEGIN {exit !(seconds <= 2147483.647)}'; then
  echo 'Timeout must be between 0 and 2147483.647 seconds' >&2
  exit 2
fi
ready=1
if awk -v seconds="$1" 'BEGIN {exit !(seconds > 0)}'; then
  # shellcheck disable=SC2016
  timeout --kill-after=1 "$1" bash -c 'until bash "$1/tooling/scripts/desktop/query.sh" exists >/dev/null 2>&1; do sleep 0.25; done' _ "$repo" && ready=0
else
  bash "$repo/tooling/scripts/desktop/query.sh" exists >/dev/null 2>&1 && ready=0
fi
bash "$repo/tooling/scripts/desktop/status.sh"
exit "$ready"
