#!/usr/bin/env bash
# Open the desktop viewer in the host browser, from inside the container.
#
# Only a VS Code remote terminal can reach the host browser (through its IPC
# bridge); other shells get the printed URL. STUDY_OPEN_BROWSER=0 opts out, as
# agent runs do, so background work never opens tabs on the maintainer's screen.
set -uo pipefail
url='http://127.0.0.1:5900/vnc.html?autoconnect=1&reconnect=1&resize=scale'
printf 'Study desktop: %s\n' "$url"
if [ "${STUDY_OPEN_BROWSER:-1}" = 0 ]; then
  exit 0
fi
if [ -n "${VSCODE_IPC_HOOK_CLI:-}" ] && command -v code >/dev/null 2>&1; then
  if timeout 5 code --openExternal "$url" >/dev/null 2>&1; then
    exit 0
  fi
fi
echo "Open the link above in your browser (no VS Code terminal to open it for you)."
