#!/usr/bin/env bash
# `just run` is the human entry point: show the desktop, then run the app in this
# terminal. Keep the host browser (the viewer) separate from container Chromium
# (OAuth sign-in); localhost means a different machine in each of those browsers.
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
  # A direct run prepares the desktop. desktop-attach already did this before
  # starting the background app, so it passes an internal marker.
  if [ "${STUDY_DESKTOP_ATTACHED:-0}" != 1 ]; then
    bash "$repo/.devcontainer/desktop/attach.sh" --serve-only 7>&-
  fi
  # shellcheck source=/dev/null
  . "$repo/target/desktop.env"
  unset DISPLAY WAYLAND_SOCKET

  # Open the viewer on the host when a VS Code remote terminal provides its
  # IPC bridge. Plain docker/devcontainer CLI shells cannot open a host browser;
  # the printed URL is the portable fallback. Background agent runs opt out.
  bash "$repo/.devcontainer/desktop/open.sh" 7>&-

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
cargo run --locked -p study 7>&-
