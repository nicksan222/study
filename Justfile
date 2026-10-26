# Workspace tasks. Run `just --list` for commands; see CONTRIBUTING.md for setup.

set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments

default:
    @just --list

# Trim stale Cargo binaries to a size budget in GB.
trim budget_gb="40":
    python3 .devcontainer/trim.py "$1"

# Replace development data with sample projects and study material.
reset-data: trim
    bash .devcontainer/desktop/reset-data.sh

# Run the native app on the browser desktop; Ctrl+C stops it.
run: trim
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
      geometry=$(python3 .devcontainer/desktop/window.py geometry)
      grim -s "$3" -g "$geometry" "$2"
    fi
    echo "$2"

# Click X,Y within the app window; button: left, middle, or right.
desktop-click x y button="left":
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    position=$(python3 .devcontainer/desktop/window.py position)
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
    geometry=$(python3 .devcontainer/desktop/window.py geometry)
    scale=$(python3 .devcontainer/desktop/window.py scale)
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

# Read-only native app/desktop status as JSON.
desktop-status:
    python3 tooling/development/desktop.py status

# Wait for the managed native Study window without restarting or taking control.
desktop-wait timeout="120":
    python3 tooling/development/desktop.py wait --timeout "$1"

# Start the web app and RPC backend; accepts --port and --production.
web *args:
    exec bash tooling/development/web.sh "$@"

# Format every workspace package.
fmt:
    cargo fmt --all

# Check formatting without modifying files.
fmt-check:
    cargo fmt --all -- --check

# Lint every package and target.
lint: trim
    cargo clippy --locked --workspace --all-targets -- -D warnings

# Run headless tests for all packages, including those against real services in Docker.
test: trim
    cargo test --locked --workspace --all-targets
    cargo test --locked --workspace --doc

# Build the API docs, failing on broken links, so doc comments cannot drift from the code.
docs:
    RUSTDOCFLAGS="-D warnings" cargo doc --locked --workspace --no-deps --document-private-items

# Record the web demo using an isolated real backend; no sign-in needed.
demo output="apps/landing/public/demo.gif":
    #!/usr/bin/env bash
    set -euo pipefail
    export STUDY_E2E_PORT="${STUDY_E2E_PORT:-1424}"
    export STUDY_E2E_ARTIFACTS="$PWD/target/captures"
    export STUDY_CAPTURE=demo STUDY_DEMO_OUTPUT="$1"
    exec just e2e --grep @demo

# Capture website media; filter by scene, language/theme, or missing.
docs-media *only:
    #!/usr/bin/env bash
    set -euo pipefail
    export STUDY_E2E_PORT="${STUDY_E2E_PORT:-1424}"
    export STUDY_E2E_ARTIFACTS="$PWD/target/captures"
    export STUDY_CAPTURE=docs STUDY_CAPTURE_FILTER="$*"
    exec just e2e --pass-with-no-tests --grep @capture

# Refresh the demo and all website captures.
captures: docs-media demo

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

# Check dependencies for known vulnerabilities, licenses and sources (deny.toml).
deny:
    cargo deny --locked check

# Type-check, lint, test, and build the frontend.
frontend-check:
    npm run typecheck
    npm run lint
    npm run test
    npm run build

# Generate protobuf clients and the canonical bilingual catalog.
gen-protocol:
    cargo run --locked -q -p study-dev -- generate

# Fail if generated protobuf clients/localized copy differ from the canonical sources.
protocol-check:
    cargo run --locked -q -p study-dev -- generate --check

# Run release configuration, verification, or assembly commands.
release *args:
    exec bash tooling/release/release.sh "$@"

# Test development and release tooling.
tooling-test:
    node --test apps/desktop/src-tauri/tests/*.test.mjs
    node node_modules/typescript/bin/tsc --noEmit -p tooling/tsconfig.json
    python3 -m unittest discover -s tooling/development -p 'test_*.py'
    python3 -m unittest discover -s tooling/release -p 'test_*.py'

# Real browser -> production frontend -> generated gRPC client -> isolated database.
e2e *args:
    exec node node_modules/@playwright/test/cli.js test --config tooling/e2e/playwright.config.ts "$@"

# Run checks required for pull requests.
check: check-shell fmt-check lint deny test docs frontend-check protocol-check tooling-test e2e landing-check

# Format-check, lint, test, and document one Rust package.
check-crate package: trim
    cargo fmt -p "$1" -- --check
    cargo clippy --locked -p "$1" --all-targets -- -D warnings
    cargo test --locked -p "$1" --all-targets
    cargo test --locked -p "$1" --doc
    RUSTDOCFLAGS="-D warnings" cargo doc --locked -p "$1" --no-deps --document-private-items

# Run all checks and build the native app.
ci: check build

# Benchmark this machine and print its report as JSON.
benchmark *args:
    cargo run --locked --release -p study-ai --example benchmark -- "$@"

# Transcribe real speech with the default local model (downloads ~670 MB on first run).
test-transcription-e2e:
    cargo test --locked -p study-ai --test stt_local_e2e -- --ignored --nocapture

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

# Prepare a PR recording: at most 15 seconds and 8 MB; MP4 or GIF.
showcase input output:
    cargo run --locked -q -p study-showcase -- convert "$1" "$2"
