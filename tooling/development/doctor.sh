#!/usr/bin/env bash
# Diagnose installed tools; never install or start services here.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit
failed=0
check() {
  local name=$1; shift
  if "$@"; then printf 'ok %s\n' "$name"; else printf 'FAIL %s\n' "$name" >&2; failed=1; fi
}
for tool in node npm bun cargo protoc just; do check "$tool" "$tool" --version; done
check 'frontend dependencies' test -f node_modules/vite/package.json
check 'Playwright Chromium' node --input-type=module -e 'import {chromium} from "@playwright/test"; import {existsSync} from "node:fs"; process.exit(existsSync(chromium.executablePath()) ? 0 : 1)'
if [[ $(uname -s) == Linux ]]; then
  check 'GTK3 / WebKitGTK / libsoup' pkg-config --exists gtk+-3.0 webkit2gtk-4.1 libsoup-3.0
  for tool in dbus-daemon dbus-send sway grim wtype wf-recorder ffmpeg curl flock setsid; do check "$tool" command -v "$tool"; done
  check 'desktop status' python3 tooling/development/desktop.py status
  if [[ -f target/desktop.env ]] && bash -c '. target/desktop.env && swaymsg -t get_version >/dev/null 2>&1'; then
    check 'managed desktop D-Bus session' bash -c '. target/desktop.env && dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames >/dev/null'
  fi
fi
exit "$failed"
