#!/usr/bin/env bash
# Start one background Study app and wait for its Wayland window.
set -euo pipefail

repo=$(realpath "$(dirname "${BASH_SOURCE[0]}")/../..")
desk="$repo/target/desktop"
env_file="$repo/target/desktop.env"
timeout=${1:-900}

if [ ! -f "$env_file" ]; then
  echo "No desktop: run just desktop" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$env_file"

# Hold the launch lock until the window is ready. The app closes this descriptor.
exec 8>"$desk/app.lock"
flock 8
window_exists() { python3 "$repo/.devcontainer/desktop/window.py" exists; }
if window_exists; then
  echo "Study is already running"
  exit 0
fi

unset DISPLAY
# attach.sh has already served the desktop when it calls this script. A direct
# desktop-run still goes through run.sh's normal transport setup.
STUDY_OPEN_BROWSER=0 setsid nohup just run >"$desk/app.log" 2>&1 </dev/null 8>&- &
app_pid=$!
echo "$app_pid" >"$desk/app.pid"
start=$SECONDS
until window_exists; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    tail -20 "$desk/app.log"
    echo "Study exited" >&2
    exit 1
  fi
  if [ $((SECONDS - start)) -ge "$timeout" ]; then
    echo "No window after $timeout seconds: see $desk/app.log" >&2
    exit 1
  fi
  sleep 0.5
done
echo "Study is up after $((SECONDS - start)) s; log: $desk/app.log"
