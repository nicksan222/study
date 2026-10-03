#!/usr/bin/env bash
# Start or resize the managed headless sway desktop.
set -euo pipefail

repo=$(realpath "$(dirname "${BASH_SOURCE[0]}")/../..")
desk="$repo/target/desktop"
env_file="$repo/target/desktop.env"
screen=${1:-display}

case "$screen" in
  display|display-23) size=1920x1080 scale=1 what="23-24 inch monitor, 1080p" ;;
  display-27) size=2560x1440 scale=1 what="27 inch monitor, 1440p" ;;
  display-4k) size=1920x1080 scale=2 what="27 inch 4K monitor at 2x" ;;
  mac-air-13) size=1470x956 scale=2 what="13 inch MacBook Air" ;;
  mac-air-15) size=1710x1112 scale=2 what="15 inch MacBook Air" ;;
  mac-pro-14) size=1512x982 scale=2 what="14 inch MacBook Pro" ;;
  mac-pro-16) size=1728x1117 scale=2 what="16 inch MacBook Pro" ;;
  laptop) size=1536x864 scale=1.25 what="14-15 inch 1080p laptop at 125%" ;;
  laptop-hd) size=1366x768 scale=1 what="budget HD laptop" ;;
  small) size=1024x640 scale=1 what="small window-sized screen" ;;
  list)
    cat <<'SCREENS'
display     23-24 in 1080p (default) 1920x1080@1
display-27  27 in 1440p             2560x1440@1
display-4k  27 in 4K at 2x          1920x1080@2
mac-air-13  13 in MacBook Air        1470x956@2
mac-air-15  15 in MacBook Air        1710x1112@2
mac-pro-14  14 in MacBook Pro        1512x982@2
mac-pro-16  16 in MacBook Pro        1728x1117@2
laptop      1080p laptop at 125%     1536x864@1.25
laptop-hd   budget HD laptop         1366x768@1
small       small screen             1024x640@1
WxH@SCALE   any other, e.g. 1440x900@2
SCREENS
    exit 0 ;;
  *x*)
    IFS=@ read -r size scale <<< "$screen"
    scale=${scale:-1}
    if ! [[ "$size" =~ ^[1-9][0-9]*x[1-9][0-9]*$ ]] ||
      ! [[ "$scale" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! [[ "$scale" =~ [1-9] ]]; then
      echo "Invalid screen: use positive WIDTHxHEIGHT@SCALE, for example 1440x900@2." >&2
      exit 1
    fi
    what="custom" ;;
  *) echo "unknown screen $screen: see just desktop list" >&2; exit 1 ;;
esac

# Sway takes physical pixels; app screenshots and clicks use logical pixels.
w=${size%x*} h=${size#*x}
mode=$(awk -v w="$w" -v h="$h" -v s="$scale" 'BEGIN { printf "%dx%d", w * s + 0.5, h * s + 0.5 }')
mkdir -p "$desk"

desktop_is_running() {
  [ -f "$env_file" ] || return 1
  # shellcheck source=/dev/null
  . "$env_file"
  swaymsg -t get_version >/dev/null 2>&1
}

if ! desktop_is_running; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -u)}" STUDY_DESKTOP_ENV="$env_file"
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  rm -f "$env_file"
  WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
    setsid nohup sway -c "$repo/.devcontainer/desktop/sway.config" >"$desk/sway.log" 2>&1 </dev/null &
  for _ in $(seq 100); do
    [ -s "$env_file" ] && break
    sleep 0.1
  done
  if [ ! -s "$env_file" ]; then
    tail "$desk/sway.log"
    echo "Sway did not start" >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  . "$env_file"
fi

# Resizing an existing desktop preserves the app's in-memory state.
swaymsg -q output HEADLESS-1 resolution "$mode" scale "$scale"
echo "Desktop: $what, ${size} logical at ${scale}x ($mode pixels) on $WAYLAND_DISPLAY. In each shell: . target/desktop.env"
echo "Then: just desktop-run | desktop-shot | desktop-click X Y | desktop-window | desktop-record; wtype, swaymsg, grim"
