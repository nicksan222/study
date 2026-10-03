#!/usr/bin/env bash
# Stop the managed headless desktop without touching unrelated processes.
#
# PID reuse is possible after any recorded process exits, so every PID is checked
# against its owner and command line before it is signaled. Browser profile and
# development data are deliberately retained.
set -euo pipefail
script_dir=$(dirname "${BASH_SOURCE[0]}")
repo=$(realpath "$script_dir/../..")
desk="$repo/target/desktop"
services=(novnc wayvnc browser app)
# --app stops only Study, keeping the desktop and viewer for a restart.
app_only=0
case "${1:-}" in
  "") ;;
  --app) app_only=1 services=(app) ;;
  *) echo "usage: stop.sh [--app]" >&2; exit 2 ;;
esac
mkdir -p "$desk"

# Serialize against attach.sh, which creates the transport PID files.
# Take the app-start lock before the transport lock, matching desktop-run -> run
# -> attach. This lets an in-flight launch finish and avoids a circular wait.
exec 8>"$desk/app.lock"
flock 8
exec 9>"$desk/attach.lock"
flock 9

# Stop outer services first so clients cannot reconnect while Study and sway are
# shutting down. Each pattern identifies the exact instance managed by this repo.
for service in "${services[@]}"; do
  file="$desk/$service.pid"
  if [ ! -s "$file" ]; then
    continue
  fi
  pid=$(cat "$file")
  if [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ] && [ -d "/proc/$pid" ]; then
    if [ "$(stat -c %u "/proc/$pid")" != "$(id -u)" ]; then
      echo "Not stopping foreign PID $pid" >&2
      exit 1
    fi
    case "$service" in
      novnc) pattern='0.0.0.0:5900 127.0.0.1:5901' ;;
      wayvnc) pattern='wayvnc 127.0.0.1 5901' ;;
      browser) pattern="--user-data-dir=$desk/browser-profile" ;;
      app) pattern='just run' ;;
    esac
    if tr '\0' ' ' <"/proc/$pid/cmdline" | grep -Fq -- "$pattern"; then
      # setsid-managed services own a process group; stopping the group also
      # catches their children. Fall back to the single process for app PIDs.
      process_group=$(ps -o pgid= -p "$pid")
      signal_target="$pid"
      if [ "$process_group" -eq "$pid" ]; then
        signal_target="-$pid"
      fi
      kill -- "$signal_target" 2>/dev/null || true
      # Keep tracking until shutdown completes. A timeout preserves the PID file
      # and reports failure instead of claiming the desktop is ready to restart.
      if ! python3 "$script_dir/wait.py" "$signal_target"; then
        echo "$service is still stopping; retry desktop-stop shortly." >&2
        exit 1
      fi
    else
      echo "Stale $service PID $pid belongs to another process; leaving it alone" >&2
    fi
  fi
  rm -f "$file"
done

if ((app_only)); then
  echo "Study stopped; desktop kept."
  exit 0
fi

# The compositor is last. Its socket is the authority for the seat helper and all
# Wayland clients, and removing desktop.env prevents later callers using it.
if [ -f "$repo/target/desktop.env" ]; then
  # shellcheck source=/dev/null
  . "$repo/target/desktop.env"
  swaymsg -q exit 2>/dev/null || true
  rm -f "$repo/target/desktop.env"
fi
echo "Desktop stopped; development data and browser profile kept."
