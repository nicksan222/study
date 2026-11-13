#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo"
set -- "${1:?Supply X}" "${2:?Supply Y}" "${3:-left}"
# shellcheck source=/dev/null
. "$repo/target/desktop.env"
position=$(bash "$repo/tooling/scripts/desktop/query.sh" position)
read -r window_x window_y <<< "$position"
case "$3" in
  left|middle|right) button="$3" ;;
  *) echo "Button must be left, middle or right"; exit 1 ;;
esac
# Convert a point in the app screenshot to a point on the desktop.
x=$((window_x + $1))
y=$((window_y + $2))
swaymsg -q seat - cursor set "$x" "$y"
# Real virtual-pointer events also work inside GTK popup grabs (native menus/dialogs).
wlrctl pointer click "$button"
