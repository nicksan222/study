#!/usr/bin/env bash
# Runs on the host, detached by initialize.sh: wait until the container's
# postStartCommand serves the desktop viewer, then open it in the host browser.
# Works for VS Code and the devcontainer CLI alike, since appPort publishes the
# viewer on host loopback. STUDY_OPEN_BROWSER=0 on the host opts out.
set -uo pipefail
url='http://127.0.0.1:5900/vnc.html?autoconnect=1&reconnect=1&resize=scale'

if [ "${STUDY_OPEN_BROWSER:-1}" = 0 ] || [ -n "${CI:-}" ] || ! command -v curl >/dev/null 2>&1; then
  exit 0
fi
case "$(uname -s)" in
  Darwin) opener=(open) ;;
  *)
    # A host without a graphical session (SSH, CI) has nowhere to show it.
    if [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] || ! command -v xdg-open >/dev/null 2>&1; then
      exit 0
    fi
    opener=(xdg-open) ;;
esac

# One waiter at a time: reopening the window while one waits must not open two tabs.
pid_file="${TMPDIR:-/tmp}/study-desktop-open.$(id -u).pid"
if [ -s "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  exit 0
fi
echo $$ >"$pid_file"
trap 'rm -f "$pid_file"' EXIT

# Docker's port proxy accepts TCP before anything listens inside, so ask for the
# page itself. The first image build can take a long time; give up after 90 min.
for _ in $(seq 2700); do
  if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
    "${opener[@]}" "$url" >/dev/null 2>&1
    exit 0
  fi
  sleep 2
done
