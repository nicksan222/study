#!/usr/bin/env bash
# Publish the headless Study desktop through noVNC.
#
# The compositor and Study app are managed by the Justfile. This script adds two
# transport processes around them: wayvnc serves VNC on container loopback, and
# websockify serves the noVNC page/WebSocket on the container port forwarded to
# host loopback. Re-running the script reuses healthy managed processes.

set -euo pipefail

script_dir=$(dirname "${BASH_SOURCE[0]}")
repo=$(realpath "$script_dir/../..")
desk="$repo/target/desktop"
desktop_env="$repo/target/desktop.env"
url='http://127.0.0.1:5900/vnc.html?autoconnect=1&reconnect=1&resize=scale'
# `just run` needs the display/transport before launching Study itself. This internal
# mode avoids the cycle run -> attach -> desktop-run -> run.
start_app=1
case "${1:-}" in
  "") ;;
  --serve-only) start_app=0 ;;
  *) echo "usage: attach.sh [--serve-only]" >&2; exit 2 ;;
esac
mkdir -p "$desk"
# Starting and inspecting both transport processes is one transaction. The stop
# script takes the same lock, so it cannot remove PID files halfway through.
exec 9>"$desk/attach.lock"
flock 9

fail() {
  printf 'desktop attach: %s\n' "$*" >&2
  exit 1
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing $1; rebuild the development container to install its desktop tools"
  fi
}

# desktop.env contains the compositor socket chosen by `just desktop`. Loading
# it and asking sway is stronger evidence than trusting a possibly stale PID.
desktop_alive() {
  if [ ! -s "$desktop_env" ]; then
    return 1
  fi
  # shellcheck source=/dev/null
  . "$desktop_env"
  unset DISPLAY WAYLAND_SOCKET
  swaymsg -t get_version >/dev/null 2>&1
}

if ! desktop_alive; then
  if ! bash "$script_dir/screen.sh" 9>&-; then
    fail "could not start the headless desktop; see $desk/sway.log"
  fi
  if ! desktop_alive; then
    fail "the desktop started without a usable $desktop_env"
  fi
fi

need wayvnc
need websockify
need python3

# Debian and other distributions install noVNC under differently cased paths.
# NOVNC_WEB remains an escape hatch for another packaged layout.
novnc_web=${NOVNC_WEB:-}
if [ -z "$novnc_web" ]; then
  for candidate in /usr/share/novnc /usr/share/noVNC; do
    if [ -f "$candidate/vnc.html" ]; then
      novnc_web=$candidate
      break
    fi
  done
fi
if [ -z "$novnc_web" ] || [ ! -f "$novnc_web/vnc.html" ]; then
  fail "cannot find noVNC's vnc.html; rebuild the development container to install noVNC"
fi

# PID files are advisory. Before reusing or signaling one, require both the
# current uid and a stable fragment of the command line to match.
pid_is_ours() {
  local pid=$1
  if [ ! -d "/proc/$pid" ]; then
    return 1
  fi
  local owner current_user
  owner=$(stat -c %u "/proc/$pid")
  current_user=$(id -u)
  [ "$owner" = "$current_user" ]
}

pid_matches() {
  local pid=$1 pattern=$2
  if ! pid_is_ours "$pid"; then
    return 1
  fi
  tr '\0' ' ' <"/proc/$pid/cmdline" | grep -Fq -- "$pattern"
}

# A process being alive does not mean it completed startup. Probe the actual
# listener with Python so this does not depend on netcat being installed.
port_open() {
  python3 - "$1" "$2" <<'PY'
import socket
import sys
with socket.socket() as sock:
    sock.settimeout(0.2)
    try:
        sock.connect((sys.argv[1], int(sys.argv[2])))
    except OSError:
        raise SystemExit(1)
PY
}

wait_for_port() {
  local pid=$1 host=$2 port=$3 log=$4
  for _ in $(seq 1 50); do
    if port_open "$host" "$port"; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  printf 'desktop attach: service did not listen on %s:%s; log follows:\n' "$host" "$port" >&2
  tail -n 30 "$log" >&2 2>/dev/null || true
  return 1
}

# Reuse a healthy process recorded in pid_file, reject an unmanaged listener,
# or detach a new process and wait until its port accepts connections. Cleanup
# after a failed launch is limited to the PID created in this invocation.
ensure_service() {
  local name=$1 pid_file=$2 pattern=$3 host=$4 port=$5 log=$6
  shift 6
  if [ -s "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      if ! pid_matches "$pid" "$pattern"; then
        fail "$pid_file names PID $pid, which is not this desktop's $name; left it untouched"
      fi
      if ! port_open "$host" "$port"; then
        fail "$name PID $pid is alive but $host:$port is unavailable; see $log"
      fi
      return 0
    fi
    rm -f "$pid_file"
  fi
  if port_open "$host" "$port"; then
    fail "$host:$port is already in use without this desktop's $name PID file"
  fi
  setsid nohup "$@" >"$log" 2>&1 </dev/null 9>&- &
  local pid=$!
  printf '%s\n' "$pid" >"$pid_file"
  if ! wait_for_port "$pid" "$host" "$port" "$log"; then
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    fail "$name failed to start"
  fi
}

# Keep raw VNC private to the container; only the WebSocket/HTTP bridge binds
# the port exported by the devcontainer.
ensure_service \
  wayvnc "$desk/wayvnc.pid" "wayvnc 127.0.0.1 5901" 127.0.0.1 5901 "$desk/wayvnc.log" \
  wayvnc 127.0.0.1 5901

ensure_service \
  noVNC "$desk/novnc.pid" "0.0.0.0:5900 127.0.0.1:5901" 127.0.0.1 5900 "$desk/novnc.log" \
  websockify --web "$novnc_web" 0.0.0.0:5900 127.0.0.1:5901

# A TCP listener alone can still be a broken websockify/noVNC setup. Verify the
# actual entry page before advertising the URL.
if ! python3 - "$url" <<'PY'
import sys
import urllib.request
with urllib.request.urlopen(sys.argv[1], timeout=2) as response:
    if response.status != 200:
        raise SystemExit(f"HTTP {response.status}")
PY
then
  fail "noVNC is listening but its page is unavailable; see $desk/novnc.log"
fi

# Release the transport lock before starting the app. The app launch takes its
# own lock while waiting for the window; stop.sh uses both locks.
flock -u 9
if ((start_app)); then
  # The transport was just checked. Reuse it when starting the app.
  if ! STUDY_DESKTOP_ATTACHED=1 just --justfile "$repo/Justfile" desktop-run 9>&-; then
    fail "could not start Study; see $desk/app.log"
  fi
fi

printf 'Study desktop: %s\n' "$url"
printf 'Processes: wayvnc PID %s, noVNC PID %s\n' \
  "$(cat "$desk/wayvnc.pid")" "$(cat "$desk/novnc.pid")"
