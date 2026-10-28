# Workspace tasks. Run `just --list` for commands; see CONTRIBUTING.md for setup.

set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments

default:
    @just --list

# Run the native app on the browser desktop; Ctrl+C stops it.
run:
    bash .devcontainer/desktop/run.sh

# Where `desktop` keeps its env, logs, screenshots and videos.
desk := justfile_directory() / "target/desktop"

# Restart the app and desktop, keeping data. Screen: `list`, a preset, or WxH@SCALE.
desktop screen="display":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "$1" = list ]; then
        exec bash .devcontainer/desktop/screen.sh list
    fi
    bash .devcontainer/desktop/stop.sh
    bash .devcontainer/desktop/screen.sh "$1"
    bash .devcontainer/desktop/attach.sh --serve-only >/dev/null
    bash .devcontainer/desktop/open.sh
    echo "Building and starting Study; log: target/desktop/app.log"
    bash .devcontainer/desktop/app.sh

# Change screen without restarting the app: a preset or WxH@SCALE.
desktop-screen screen="display":
    @bash .devcontainer/desktop/screen.sh "$1"

# Follow Tauri/Vite rebuilds; Ctrl+C detaches and keeps the app running.
desktop-watch:
    python3 .devcontainer/desktop/watch.py

# Start the app in the background and wait for its window.
desktop-run timeout="900":
    @bash .devcontainer/desktop/app.sh "$1"

# Set window mode: full (maximized), float, or fullscreen.
desktop-window mode="full":
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    app='[app_id="study"]'
    case "$1" in
      full) swaymsg -q "$app" fullscreen disable, floating disable ;;
      float) swaymsg -q "$app" fullscreen disable, floating enable, resize set 1200 800, move position center ;;
      fullscreen) swaymsg -q "$app" fullscreen enable ;;
      *) echo "mode is full, float or fullscreen"; exit 1 ;;
    esac

# Screenshot the window or screen to PNG; coordinates use logical pixels.
desktop-shot what="window" path=(desk / "window.png") scale="1":
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    if [ "$1" = screen ]; then
      grim -s "$3" "$2"
    else
      geometry=$(just --quiet desktop-query geometry)
      grim -s "$3" -g "$geometry" "$2"
    fi
    echo "$2"

# Click X,Y within the app window; button: left, middle, or right.
desktop-click x y button="left":
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    position=$(just --quiet desktop-query position)
    read -r window_x window_y <<< "$position"
    case "$3" in
      left|middle|right) button="$3" ;;
      *) echo "Button must be left, middle or right"; exit 1 ;;
    esac
    # Convert a point in the app screenshot to a point on the desktop.
    x=$((window_x + $1))
    y=$((window_y + $2))
    swaymsg -q seat - cursor set "$x" "$y"
    # Real virtual-pointer events also work inside GTK popup grabs (native menus/dialogs).
    wlrctl pointer click "$button"

# Record the app window to MP4; run with `&` to interact while recording.
desktop-record seconds="5" path=(desk / "clip.mp4"):
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    geometry=$(just --quiet desktop-query geometry)
    scale=$(just --quiet desktop-query scale)
    # Recorded in logical pixels, as screenshots are.
    # H.264 requires even pixel dimensions. SIGINT gives the recorder time to
    # finish its output; timeout's 124 exit means the requested duration elapsed.
    filter="scale=trunc(iw/$scale/2)*2:trunc(ih/$scale/2)*2"
    # Request frames even on a static desktop; otherwise shutdown can wait for
    # damage that never arrives. Bound shutdown too if the encoder misbehaves.
    status=0
    timeout --kill-after=5 -s INT "$1" wf-recorder --no-damage -y -g "$geometry" -F "$filter" -f "$2" >"{{desk}}/record.log" 2>&1 || status=$?
    if [ "$status" -ne 0 ] && [ "$status" -ne 124 ]; then
      cat "{{desk}}/record.log" >&2
      exit "$status"
    fi
    echo "$2"

# Start the app and attach from any host browser; prints the local desktop URL.
desktop-attach:
    bash .devcontainer/desktop/attach.sh

# Open a page inside the desktop, with a persistent Chromium profile for sign-in.
desktop-browser *args:
    bash .devcontainer/desktop/browser.sh "$@"

# Stop the app, browser and virtual desktop without deleting their data.
desktop-stop:
    bash .devcontainer/desktop/stop.sh

# Inspect a native window value: exists, geometry, position, or scale.
desktop-query value:
    #!/usr/bin/env bash
    set -euo pipefail
    # shellcheck source=/dev/null
    . "{{justfile_directory()}}/target/desktop.env"
    : "${SWAYSOCK:?Managed desktop has no SWAYSOCK; run just desktop}"
    case "$1" in
      scale)
        timeout 2 swaymsg -t get_outputs | jq -er '[.[] | select(.name == "HEADLESS-1") | .scale | select(type == "number" and . > 0)][0] // error("Managed output has no valid scale")'
        ;;
      exists|geometry|position)
        rect=$(timeout 2 swaymsg -t get_tree | jq -ce '[.. | objects | select(.app_id? == "study") | .rect][0] // empty')
        jq -e 'all(.x, .y, .width, .height; type == "number" and . == floor) and .width >= 0 and .height >= 0' <<< "$rect" >/dev/null
        case "$1" in
          exists) ;;
          geometry) jq -r '"\(.x),\(.y) \(.width)x\(.height)"' <<< "$rect" ;;
          position) jq -r '"\(.x) \(.y)"' <<< "$rect" ;;
        esac
        ;;
      *) echo 'Expected exists, geometry, position or scale' >&2; exit 2 ;;
    esac

# Read-only native app/desktop status as JSON.
desktop-status:
    #!/usr/bin/env bash
    set -euo pipefail
    desktop=false window=false
    [ ! -f target/desktop.env ] || desktop=true
    diagnostic=$(just --quiet desktop-query exists 2>&1) && window=true
    bus=$(python3 .devcontainer/desktop/lifecycle.py dbus status) || true
    pid=null
    if [ -f "{{desk}}/app.pid" ]; then
      candidate=$(cat "{{desk}}/app.pid")
      if [[ "$candidate" =~ ^[0-9]+$ ]] && [ "$candidate" -gt 1 ] && [ -d "/proc/$candidate" ]; then pid=$candidate; fi
    fi
    jq -n --argjson desktop "$desktop" --argjson window "$window" --argjson bus "$bus" --argjson pid "$pid" --arg log "{{desk}}/app.log" --arg diagnostic "$diagnostic" '{desktop: $desktop, window: $window, dbus: $bus.dbus, dbusAddress: $bus.address, pid: $pid, log: $log} + (if $diagnostic == "" then {} else {diagnostic: $diagnostic} end)'

# Wait for the managed native Study window without restarting or taking control.
desktop-wait timeout="120":
    #!/usr/bin/env bash
    set -euo pipefail
    if ! [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! awk -v seconds="$1" 'BEGIN {exit !(seconds <= 2147483.647)}'; then
      echo 'Timeout must be between 0 and 2147483.647 seconds' >&2
      exit 2
    fi
    ready=1
    if awk -v seconds="$1" 'BEGIN {exit !(seconds > 0)}'; then
      timeout --kill-after=1 "$1" bash -c 'until just --quiet desktop-query exists >/dev/null 2>&1; do sleep 0.25; done' && ready=0
    else
      just --quiet desktop-query exists >/dev/null 2>&1 && ready=0
    fi
    just --quiet desktop-status
    exit "$ready"

# Format Rust and all project-owned web source and configuration.
fmt:
    cargo fmt --all
    npm run format

# Check formatting without modifying files.
fmt-check:
    cargo fmt --all -- --check
    npm run format:check

# Lint Rust targets and enforce repository-wide Vite+ format/lint policy.
lint:
    cargo clippy --locked --workspace --all-targets -- -D warnings
    npm run lint

# Run headless tests for all packages, including those against real services in Docker.
test:
    cargo test --locked --workspace --all-targets
    cargo test --locked --workspace --doc

# Build the API docs, failing on broken links, so doc comments cannot drift from the code.
docs:
    RUSTDOCFLAGS="-D warnings" cargo doc --locked --workspace --no-deps --document-private-items

# Serve the website with live reload at localhost:4321/study/.
landing:
    cd apps/landing && bun install --frozen-lockfile && bun run dev --host

# Build the website from committed captures into apps/landing/dist.
landing-build:
    cd apps/landing && bun install --frozen-lockfile && npm run build

# Check website types and content without requiring captures.
landing-check:
    cd apps/landing && bun install --frozen-lockfile && bun run check

# Build the distributable desktop binary.
build:
    npm run desktop:build -- --no-bundle -- --locked

# Build and sign the native installer/AppImage (see CONTRIBUTING.md for signing setup).
package platform *args:
    exec bash tooling/release/release.sh build "$@"

# Check dependencies for known vulnerabilities, licenses and sources.
deny:
    cargo deny --locked --config tooling/rust/deny.toml check

# Type-check, test, and build the frontend. Repository lint runs in `just lint`.
frontend-check:
    npm run typecheck
    npm run test
    npm run build

# Check the TypeScript backend packages against the actual Node runtime.
backend-check:
    npm run backend:typecheck
    npm run backend:test

# Generate database migrations and web routes.
gen:
    bun gen

# Check generated outputs without changing the database schema.
gen-check:
    bun gen:check

# Run release configuration, verification, or assembly commands.
release *args:
    exec bash tooling/release/release.sh "$@"

# Test development and release tooling.
tooling-test:
    npm run quality:test
    node --test --test-reporter=spec apps/desktop/src-tauri/tests/*.test.mjs
    python3 -m unittest discover -s tooling/development -p 'test_*.py'
    python3 -m unittest discover -s tooling/release -p 'test_*.py'

# Run checks required for pull requests.
check: check-shell fmt-check lint deny test docs backend-check frontend-check gen-check tooling-test landing-check

# Format-check, lint, test, and document one Rust package.
check-crate package:
    cargo fmt -p "$1" -- --check
    cargo clippy --locked -p "$1" --all-targets -- -D warnings
    cargo test --locked -p "$1" --all-targets
    cargo test --locked -p "$1" --doc
    RUSTDOCFLAGS="-D warnings" cargo doc --locked -p "$1" --no-deps --document-private-items

# Run all checks and build the native app.
ci: check build

# Both spellings start the same team; neither resets existing conversations.
alias agent := agents

# Start the maintainer team or selected roles; accepts --session, --fresh, --no-attach.
agents *args:
    python3 .agents/team/agents.py up "$@"

# Stop this team's workspace, or only the named agents. Other Herdr workspaces are untouched.
agents-stop *args:
    python3 .agents/team/agents.py down "$@"

# Reset team conversations and checkpoints, keeping code and logins.
agents-reset *args:
    python3 .agents/team/agents.py reset "$@"

# Check native/frontend/browser prerequisites and the running desktop D-Bus session.
doctor:
    bash tooling/development/doctor.sh

# Inspect subscription login and tools without starting a model.
agents-doctor *args:
    python3 .agents/team/agents.py doctor "$@"

# Local Claude token counts, including cache usage; not remaining subscription allowance.
agents-usage *args:
    python3 .agents/team/usage.py "$@"

# Lint the devcontainer and packaging shell scripts.
check-shell:
    shellcheck -x tooling/development/*.sh tooling/release/*.sh .devcontainer/initialize.sh .devcontainer/shell-env.sh .devcontainer/desktop/*.sh apps/desktop/packaging/*.sh
