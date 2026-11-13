#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
desktop=false window=false
[ ! -f target/desktop.env ] || desktop=true
diagnostic=$(bash "$repo/.devcontainer/desktop/query.sh" exists 2>&1) && window=true
bus=$(python3 .devcontainer/desktop/lifecycle.py dbus status) || true
pid=null
if [ -f "$repo/target/desktop/app.pid" ]; then
  candidate=$(cat "$repo/target/desktop/app.pid")
  if [[ "$candidate" =~ ^[0-9]+$ ]] && [ "$candidate" -gt 1 ] && [ -d "/proc/$candidate" ]; then pid=$candidate; fi
fi
jq -n --argjson desktop "$desktop" --argjson window "$window" --argjson bus "$bus" --argjson pid "$pid" --arg log "$repo/target/desktop/app.log" --arg diagnostic "$diagnostic" '{desktop: $desktop, window: $window, dbus: $bus.dbus, dbusAddress: $bus.address, pid: $pid, log: $log} + (if $diagnostic == "" then {} else {diagnostic: $diagnostic} end)'
