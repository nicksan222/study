#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo"
set -- "${1:-window}" "${2:-$repo/target/desktop/window.png}" "${3:-1}"
# shellcheck source=/dev/null
. "$repo/target/desktop.env"
if [ "$1" = screen ]; then
  grim -s "$3" "$2"
else
  geometry=$(bash "$repo/tooling/scripts/desktop/query.sh" geometry)
  grim -s "$3" -g "$geometry" "$2"
fi
echo "$2"
