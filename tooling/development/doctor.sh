#!/usr/bin/env bash
# Diagnose installed tools; never install or start services here.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit
failed=0
check() {
  local name=$1; shift
  if "$@"; then printf 'ok %s\n' "$name"; else printf 'FAIL %s\n' "$name" >&2; failed=1; fi
}
for tool in node npm bun cargo just; do check "$tool" "$tool" --version; done
check 'Vite+ dependencies' test -f node_modules/vite-plus/package.json
if [[ $(uname -s) == Linux ]]; then
  check 'GTK3 / WebKitGTK / libsoup' pkg-config --exists gtk+-3.0 webkit2gtk-4.1 libsoup-3.0
  for tool in python3 jq timeout dbus-daemon dbus-send sway grim wtype wf-recorder ffmpeg curl flock setsid; do check "$tool" command -v "$tool"; done
  check 'desktop status' just --quiet desktop-status
  if [[ -f target/desktop.env ]]; then
    check 'managed desktop D-Bus session' python3 .devcontainer/desktop/lifecycle.py dbus status
  fi
fi
exit "$failed"
