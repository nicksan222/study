#!/usr/bin/env bash
# Open OAuth callbacks and user-requested pages inside the headless desktop.
#
# Chromium stays in the Linux container so localhost redirects reach Study. Its
# profile lives under target/desktop, which is bind-mounted from the workspace
# and therefore keeps sign-in state across container rebuilds.

set -euo pipefail

script_dir=$(dirname "${BASH_SOURCE[0]}")
repo=$(realpath "$script_dir/../..")
desk="$repo/target/desktop"
desktop_env="$repo/target/desktop.env"
mkdir -p "$desk" "$desk/browser-profile"

# Refuse to start against a stale or missing Wayland socket. The caller gets an
# actionable error instead of a detached Chromium process that immediately dies.
if [ ! -s "$desktop_env" ]; then
  echo "Study browser: no desktop environment; run just desktop first" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$desktop_env"
unset DISPLAY WAYLAND_SOCKET
if ! swaymsg -t get_version >/dev/null 2>&1; then
  echo "Study browser: the saved desktop is not running; run just desktop first" >&2
  exit 1
fi

if command -v chromium >/dev/null 2>&1; then
  browser=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  browser=chromium-browser
else
  echo "Study browser: Chromium is missing; rebuild the development container" >&2
  exit 1
fi

# BROWSER callers normally pass a URL. A direct invocation without one is still
# useful for signing in, so open an empty tab. Preserve all supplied arguments.
if [ "$#" -eq 0 ]; then
  set -- about:blank
fi

# Chromium uses its normal sandbox. setsid plus redirected standard streams lets
# xdg-open return while the browser remains attached to the virtual desktop.
log="$desk/browser.log"
setsid "$browser" \
  --user-data-dir="$desk/browser-profile" \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  "$@" >>"$log" 2>&1 </dev/null &
pid=$!

# Watch the short startup window so configuration/sandbox failures reach the
# caller with Chromium's exit status and log. A zero exit can also mean an
# existing profile process accepted the URL, which is a successful handoff.
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    if wait "$pid"; then
      exit 0
    else
      status=$?
    fi
    echo "Study browser: Chromium exited with status $status; log follows:" >&2
    tail -n 30 "$log" >&2 2>/dev/null || true
    exit "$status"
  fi
  sleep 0.1
done

# Record only a process that survived startup; stop.sh validates this PID again
# before signaling it.
printf '%s\n' "$pid" >"$desk/browser.pid"
exit 0
