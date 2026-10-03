---
name: see-the-app
description: "Use when you need to run, see or use the real Study desktop app: screenshot it, click, type, record a video, read its logs."
---

# See the app

Run inside the devcontainer. The desktop recipes manage a virtual Wayland display, the
real app, and its persistent development database. Discover current arguments and defaults
with `just --list`, `just --show <recipe>`, and `just desktop list`; keep screen presets,
window dimensions, app identifiers, ports, and output locations in the tooling.

## Start and connect

- `just run` starts the app and browser viewer in the foreground. VS Code opens the viewer
  through its remote CLI bridge; other shells print the URL.
- For an agent background run, use `just desktop`. It restarts the desktop and app from
  zero and waits for the app window; herdr agents open no host browser tabs. The desktop
  is shared by the whole team: get it from the lead before restarting or driving it.
  `just desktop-run` starts the app only if none is running, and `just desktop-watch`
  rebuilds and restarts it whenever sources change.
- A running app does not include later code changes, and `just desktop-run` keeps it
  ("Study is already running"). Before judging a change, compare the binary's time
  (`stat target/devcontainer/debug/study`) with the last edit; if older, stop the app
  (`pkill -f 'target/devcontainer/debug/study$'`) and run `just desktop-run`, which
  rebuilds it. Data is kept; a schema change also needs `just reset-data`.
- Source the environment file printed by `just desktop` in each new shell before using
  `wtype`, `swaymsg`, or other display tools. The desktop outlives the invoking shell.
- `just desktop-attach` prints the live viewer URL. Use that URL rather than constructing
  one from a remembered port. `just desktop-browser` opens persistent Chromium inside the
  desktop for OAuth; `just run` directs sign-in links there too.
- `just reset-data` replaces the development database with seeded samples. Use it only
  when a fresh dataset is needed; ordinary runs keep the existing data.

## Inspect and interact

- `just desktop-shot` captures the app window and prints the PNG path. Open that image.
  Use the `screen` argument for the whole display and an explicit output path when keeping
  several shots. The default uses logical pixels, matching `just desktop-click X Y`.
- Take click coordinates from the latest screenshot. Capture again after layout changes,
  and verify the result of an action before repeating it.
- Keys and text go to the focused window: `wtype -M ctrl k -m ctrl`, `wtype 'text'`,
  `wtype -k Escape`, `wtype -k Return`.
- Scroll with `wlrctl pointer scroll VERTICAL HORIZONTAL` over the intended area. Positive
  vertical values scroll down; negative values scroll up. Sway cursor button events do
  not deliver scrolling to the app.
- Hover with `swaymsg seat - cursor set X Y`, using screen coordinates. Obtain the window
  offset with `python3 .devcontainer/desktop/window.py position` when converting from a
  window screenshot. The same helper provides `geometry` and `scale`.
- Let the app finish rendering before capturing evidence. Move the pointer away from the
  content being inspected when hover highlights or tooltips obscure it.
- `just desktop-record SECONDS OUTPUT.mp4` records the window. Run it in the background
  when interacting during the recording, then wait for it to finish writing the video.

## Check layouts and diagnose

Use `just desktop list` to choose screens relevant to the change, including a smaller
logical area and a different scale when useful. `just desktop-screen <preset>` switches
the running desktop without restarting the app. `just desktop-window full|float|fullscreen`
changes how the window fits it. Inspect each capture for clipped text, overlapping controls,
and unreachable actions; derive dimensions and scale from the selected preset.

`STUDY_LOG=debug just desktop-run` enables detailed app logs on the next launch. Follow the
log path printed by the launcher; inspect the corresponding recipe or desktop script for
other output paths and the development data location. The app also writes `diagnostics.log`
in its data directory. Artifacts are available on the host through the workspace bind mount.

Model work requires the user's ChatGPT sign-in. Use existing or seeded material when that
connection is unavailable, and report the limitation. `just desktop-stop` stops the app,
browser, and virtual desktop while keeping their data.
