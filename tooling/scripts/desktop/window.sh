#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo"
set -- "${1:-full}"
# shellcheck source=/dev/null
. "$repo/target/desktop.env"
app='[app_id="study"]'
case "$1" in
  full) swaymsg -q "$app" fullscreen disable, floating disable ;;
  float) swaymsg -q "$app" fullscreen disable, floating enable, resize set 1200 800, move position center ;;
  fullscreen) swaymsg -q "$app" fullscreen enable ;;
  *) echo "mode is full, float or fullscreen"; exit 1 ;;
esac
