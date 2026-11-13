#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo"
set -- "${1:?Supply query}"
# shellcheck source=/dev/null
. "$repo/target/desktop.env"
: "${SWAYSOCK:?Managed desktop has no SWAYSOCK; run bun run desktop}"
case "$1" in
  scale)
    timeout 2 swaymsg -t get_outputs | jq -er '[.[] | select(.name == "HEADLESS-1") | .scale | select(type == "number" and . > 0)][0] // error("Managed output has no valid scale")'
    ;;
  exists|geometry|position)
    rect=$(timeout 2 swaymsg -t get_tree | jq -ce '[.. | objects | select(.app_id? == "study") | .rect][0] // empty')
    jq -e 'all(.x, .y, .width, .height; type == "number" and . == floor) and .width >= 0 and .height >= 0' <<< "$rect" >/dev/null
    case "$1" in
      exists) ;;
      geometry) jq -r '"\(.x),\(.y) \(.width)x\(.height)"' <<< "$rect" ;;
      position) jq -r '"\(.x) \(.y)"' <<< "$rect" ;;
    esac
    ;;
  *) echo 'Expected exists, geometry, position or scale' >&2; exit 2 ;;
esac
