#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
set -- "${1:-5}" "${2:-$repo/target/desktop/clip.mp4}"
# shellcheck source=/dev/null
. "$repo/target/desktop.env"
geometry=$(bash "$repo/.devcontainer/desktop/query.sh" geometry)
scale=$(bash "$repo/.devcontainer/desktop/query.sh" scale)
# Recorded in logical pixels, as screenshots are.
# H.264 requires even pixel dimensions. SIGINT gives the recorder time to
# finish its output; timeout's 124 exit means the requested duration elapsed.
filter="scale=trunc(iw/$scale/2)*2:trunc(ih/$scale/2)*2"
# Request frames even on a static desktop; otherwise shutdown can wait for
# damage that never arrives. Bound shutdown too if the encoder misbehaves.
status=0
timeout --kill-after=5 -s INT "$1" wf-recorder --no-damage -y -g "$geometry" -F "$filter" -f "$2" >"$repo/target/desktop/record.log" 2>&1 || status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 124 ]; then
  cat "$repo/target/desktop/record.log" >&2
  exit "$status"
fi
echo "$2"
