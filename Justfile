# Study workspace tasks. Run `just --list` for available commands.
#
# Human loop: desktop-attach -> use the app in a browser -> desktop-stop.
# Agent loop: agents-doctor -> agents -> focused checks -> check -> agents-stop.
# The image installs tools; these recipes orchestrate them. Persistent app/browser data
# is separate from Cargo output even though both live beneath gitignored target/.
# Variadic recipes use positional arguments so spaces and URL query strings stay data.

default:
    @just --list

# Where `run` keeps the app database (the app follows XDG_DATA_HOME).
dev_data := justfile_directory() / "target/dev-data"

# Trim stale Cargo binaries above the size budget, preserving app/browser data and active builds.
[positional-arguments]
trim budget_gb="40":
    python3 .devcontainer/trim.py "$1"

# Delete the development database and fill a new one with sample projects, sessions, and pipeline results.
reset-data: trim
    bash .devcontainer/desktop/reset-data.sh

# Run Study and make its desktop available in your host browser. Keep this terminal open; Ctrl+C stops the app.
run: trim
    bash .devcontainer/desktop/run.sh

# Where `desktop` keeps its env, logs, screenshots and videos.
desk := justfile_directory() / "target/desktop"

# Start from zero: stop the app and desktop, start a new desktop and its browser viewer, open the viewer in the host browser (VS Code terminals; others print the URL; `STUDY_OPEN_BROWSER=0` skips it), then build and start the app in the background. Development data is kept (`just reset-data` replaces it). `screen` is a preset (`just desktop list`) or `WxH@SCALE` in logical pixels; the default is a 23-inch 1080p monitor. Writes `target/desktop.env` to source in later shells.
[positional-arguments]
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

# Switch the running desktop to another screen without restarting the app: a preset (`just desktop list`) or `WxH@SCALE`.
[positional-arguments]
desktop-screen screen="display":
    @bash .devcontainer/desktop/screen.sh "$1"

# Rebuild and restart the app on the desktop whenever its sources change; the desktop and viewer stay up. A failed build keeps the running app. Ctrl+C stops watching.
desktop-watch:
    python3 .devcontainer/desktop/watch.py

# Run the app (`just run`) on the virtual desktop in the background, logging to target/desktop/app.log; waits for its window.
[positional-arguments]
desktop-run timeout="900":
    @bash .devcontainer/desktop/app.sh "$1"

# How the app's window sits on the desktop: `full` fills the screen (the default, a maximized window), `float` is a normal window at the size it asks for, centred, and `fullscreen` hides the desktop around it as F11 would.
[positional-arguments]
desktop-window mode="full":
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    app='[app_id="io.github.nicksan222.Study"]'
    case "$1" in
      full) swaymsg -q "$app" fullscreen disable, floating disable ;;
      float) swaymsg -q "$app" fullscreen disable, floating enable, resize set 1200 800, move position center ;;
      fullscreen) swaymsg -q "$app" fullscreen enable ;;
      *) echo "mode is full, float or fullscreen"; exit 1 ;;
    esac

# Screenshot the app window (or `screen` for the whole desktop) to a PNG, by default target/desktop/window.png. It is in logical pixels, the ones `desktop-click` takes; `scale=2` keeps every Retina pixel.
[positional-arguments]
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

# Left-click at X,Y in the app window's pixels (as in its screenshot); `button` may be right or middle.
[positional-arguments]
desktop-click x y button="left":
    #!/usr/bin/env bash
    set -euo pipefail
    . "{{justfile_directory()}}/target/desktop.env"
    position=$(python3 .devcontainer/desktop/window.py position)
    read -r window_x window_y <<< "$position"
    case "$3" in
      left) button=button1 ;;
      middle) button=button2 ;;
      right) button=button3 ;;
      *) echo "Button must be left, middle or right"; exit 1 ;;
    esac
    # Convert a point in the app screenshot to a point on the desktop.
    x=$((window_x + $1))
    y=$((window_y + $2))
    swaymsg -q seat - cursor set "$x" "$y"
    swaymsg -q seat - cursor press "$button"
    swaymsg -q seat - cursor release "$button"

# Record the app window for some seconds to an mp4, by default target/desktop/clip.mp4. Run it with `&` to act while it records.
[positional-arguments]
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
[positional-arguments]
desktop-browser *args:
    bash .devcontainer/desktop/browser.sh "$@"

# Stop the app, browser and virtual desktop without deleting their data.
desktop-stop:
    bash .devcontainer/desktop/stop.sh

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

# Record the README's demo GIF (assets/demo.gif, or `output`): the built app on sample data, on a private virtual desktop. Needs no sign-in and runs no model.
[positional-arguments]
demo output="assets/demo.gif":
    cargo build --locked -p study
    cargo run --locked -p study-showcase -- "$1"

# Build the distributable desktop binary.
build:
    cargo build --locked --release -p study

# Build and sign the native installer/AppImage (see CONTRIBUTING.md for signing setup).
[positional-arguments]
package platform:
    packaging/release.sh package "$1"

# Check dependencies for known vulnerabilities, licenses and sources (deny.toml).
deny:
    cargo deny --locked check

# Run checks required for pull requests.
check: check-shell fmt-check lint deny test docs

# Run the same checks for one package only, e.g. `just check-crate study-core`: a focused development loop.
[positional-arguments]
check-crate package: trim
    cargo fmt -p "$1" -- --check
    cargo clippy --locked -p "$1" --all-targets -- -D warnings
    cargo test --locked -p "$1" --all-targets
    cargo test --locked -p "$1" --doc
    RUSTDOCFLAGS="-D warnings" cargo doc --locked -p "$1" --no-deps --document-private-items

# Run the same checks and release build as CI.
ci: check build

# Benchmark this machine and print its report as JSON.
[positional-arguments]
benchmark *args:
    cargo run --locked --release -p study-ai --example benchmark -- "$@"

# Transcribe real speech with the default local model (downloads ~670 MB on first run).
test-transcription-e2e:
    cargo test --locked -p study-ai --test stt_local_e2e -- --ignored --nocapture

# Both spellings start the same team; neither resets existing conversations.
alias agent := agents

# Start the project-wide seven-role team, or selected roles, in Herdr's study session. Options: --session NAME, --fresh, --no-attach, --dry-run.
[positional-arguments]
agents *args:
    python3 .agents/team/agents.py up "$@"

# Stop this team's workspace, or only the named agents. Other Herdr workspaces are untouched.
[positional-arguments]
agents-stop *args:
    python3 .agents/team/agents.py down "$@"

# Start fresh conversations for all seven roles, clearing the task checkpoint but preserving code and logins.
[positional-arguments]
agents-reset *args:
    python3 .agents/team/agents.py reset "$@"

# Inspect subscription login and tools without starting a model.
[positional-arguments]
agents-doctor *args:
    python3 .agents/team/agents.py doctor "$@"

# Local Claude token counts, including cache usage; not remaining subscription allowance.
[positional-arguments]
agents-usage *args:
    python3 .agents/team/usage.py "$@"

# Lint the devcontainer and packaging shell scripts.
check-shell:
    shellcheck -x .devcontainer/initialize.sh .devcontainer/shell-env.sh .devcontainer/desktop/*.sh packaging/release.sh

# Prepare a recording for a PR: first 15 seconds, no audio, at most 8 MB. Use .mp4 or .gif.
[positional-arguments]
showcase input output:
    python3 .devcontainer/desktop/showcase.py "$1" "$2"
