#!/usr/bin/env bash
# Explicit native launch: prepare Wayland and run Tauri in this terminal.
# noVNC is opt-in through `just desktop-attach`.
set -euo pipefail
script_dir=$(dirname "${BASH_SOURCE[0]}")
repo=$(realpath "$script_dir/../..")
desk="$repo/target/desktop"
export XDG_DATA_HOME="$repo/target/dev-data"

# Keep a shared lock for the app's lifetime. reset-data takes the exclusive side
# of this same lock before deleting anything. This shell owns descriptor 7;
# close it in children so desktop services cannot retain it after Study exits.
mkdir -p "$desk"
exec 7>"$desk/data.lock"
if ! flock -s -n 7; then
  echo "Development data is being reset; retry once reset-data finishes." >&2
  exit 1
fi

if [ -f /.dockerenv ] || [ -f /run/.containerenv ] || [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  if [ -f "$repo/target/desktop.env" ]; then
    # shellcheck source=/dev/null
    . "$repo/target/desktop.env"
  fi
  if [ -z "${SWAYSOCK:-}" ] || ! timeout 2 swaymsg -t get_version >/dev/null 2>&1; then
    bash "$repo/.devcontainer/desktop/screen.sh" 7>&-
  fi
  # shellcheck source=/dev/null
  . "$repo/target/desktop.env"
  export DBUS_SESSION_BUS_ADDRESS
  DBUS_SESSION_BUS_ADDRESS=$(python3 "$repo/.devcontainer/desktop/lifecycle.py" dbus ensure --env-file "$repo/target/desktop.env" --address-only)
  unset DISPLAY WAYLAND_SOCKET

  # Send Study's HTTP links to persistent Chromium inside the container. It
  # shares localhost with Study, so OAuth can finish its callback. xdg-open tries
  # MIME handlers before BROWSER, hence both settings below. Keep them in target/
  # rather than changing the user's system browser or host configuration.
  export BROWSER="$repo/.devcontainer/desktop/browser.sh"
  export XDG_CONFIG_HOME="$desk/config"
  mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME/applications"
  cat >"$XDG_CONFIG_HOME/mimeapps.list" <<'MIME'
[Default Applications]
x-scheme-handler/http=study-browser.desktop
x-scheme-handler/https=study-browser.desktop
MIME
  cat >"$XDG_DATA_HOME/applications/study-browser.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Study development browser
Exec="$BROWSER" %u
MimeType=x-scheme-handler/http;x-scheme-handler/https;
DESKTOP
fi

# Keep build output and errors in the invoking terminal. Ctrl+C reaches
# Cargo/the app through the foreground process group. This shell keeps the data
# lock until Cargo exits; the app and its children must not inherit the descriptor.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export GDK_BACKEND=wayland
bun run desktop:dev 7>&-
