#!/usr/bin/env bash
# Own the real RPC bridge and Vite for development or an isolated production consumer.
set -euo pipefail
cd "$(dirname "$0")/../.."
repo=$PWD
port=5173
production=0
port_given=0
usage() { echo 'Usage: just web [--port PORT] [--production]' >&2; exit 2; }
while (($#)); do
  case "$1" in
    --port)
      (($# >= 2 && port_given == 0)) || usage
      port=$2; port_given=1; shift 2 ;;
    --production)
      ((production == 0)) || usage
      production=1; shift ;;
    *) usage ;;
  esac
done
[[ "$port" =~ ^[0-9]{4,5}$ ]] || usage
((10#$port >= 1024 && 10#$port <= 65535)) || usage

export XDG_DATA_HOME="$repo/target/dev-data"
if [[ ${STUDY_FIXTURE_ONLY:-0} != 1 ]]; then
  mkdir -p target/desktop
  exec 7>target/desktop/data.lock
  if ! flock -s -n 7; then
    echo 'Development data is being reset; retry after reset-data finishes.' >&2
    exit 73
  fi
fi
bridge_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
export STUDY_WEB_BRIDGE_URL="http://127.0.0.1:$bridge_port"
pids=()
output=
# shellcheck disable=SC2317 # Invoked indirectly by the EXIT trap.
cleanup() {
  local status=$? pid attempt running
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  # Bound shutdown even when a compiler or server ignores SIGTERM.
  for ((attempt=0; attempt<100; attempt++)); do
    running=0
    for pid in "${pids[@]}"; do
      if kill -0 -- "-$pid" 2>/dev/null; then running=1; fi
    done
    ((running)) || break
    sleep .1
  done
  for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  if [[ -n "$output" ]]; then rm -rf -- "$output"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bridge_args=(--port "$bridge_port" --origin "http://127.0.0.1:$port")
if [[ ${STUDY_FIXTURE_ONLY:-0} == 1 ]]; then bridge_args+=(--fixture-only); fi
setsid cargo run --locked -p study-web-bridge -- "${bridge_args[@]}" &
bridge=$!
pids+=("$bridge")
deadline=$((SECONDS + 600))
until curl --fail --silent --max-time 1 "$STUDY_WEB_BRIDGE_URL/__study/health" >/dev/null; do
  if ! kill -0 "$bridge" 2>/dev/null; then echo 'RPC backend exited before becoming ready.' >&2; exit 1; fi
  if ((SECONDS >= deadline)); then echo 'RPC backend startup timed out.' >&2; exit 1; fi
  sleep .15
done
vite_args=()
if ((production)); then
  mkdir -p target/e2e
  output=$(mktemp -d "$repo/target/e2e/frontend-XXXXXX")
  setsid node node_modules/vite/bin/vite.js build --config vite.config.ts --outDir "$output" &
  build=$!
  pids+=("$build")
  # A backend failure must also interrupt a build that has not finished yet.
  finished=
  wait -n -p finished "$bridge" "$build"
  [[ "$finished" == "$build" ]] || exit 1
  # The completed build's process group no longer belongs to this launcher.
  pids=("$bridge")
  vite_args=(preview --outDir "$output")
fi
setsid node node_modules/vite/bin/vite.js "${vite_args[@]}" --config vite.config.ts --host 127.0.0.1 --port "$port" --strictPort &
pids+=("$!")
# Either server exiting ends the whole run; cleanup owns every descendant group.
status=0
wait -n "${pids[@]}" || status=$?
# Servers are long-lived; even an unexpected successful exit leaves the app unusable.
((status != 0)) || status=1
exit "$status"
