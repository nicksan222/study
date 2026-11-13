---
name: see-the-app
description: 'Use when you need to run, see or use Study: browser-first inspection, screenshots, interaction and logs; native only for Tauri-specific behavior.'
---

# See the app

## Local web is the default

Use the shared React app in the browser for roughly 99% of inspection, interaction,
screenshots and UI verification. Work inside the devcontainer. First check whether
`http://localhost:5173` already serves Study and reuse that running app. Only if it is
not working locally, run `bun dev` from the repository root, keep its logs available,
and wait for the printed URL. Do not start duplicate servers, restart a working server,
or launch Tauri/noVNC for ordinary UI work. If the port is occupied by something else,
inspect it before starting another process; never stop someone else's server.

Use the available browser tools to open the local app, inspect its current state, click,
type, scroll and capture evidence. Verify each interaction before repeating it. Check
layouts at the viewport sizes relevant to the change and inspect for clipped text,
overlaps and unreachable controls. Use real production services and repository sample
material; do not substitute a fake server to claim end-to-end coverage.

`bun dev` starts both Vite and the native Effect RPC server. Frontend changes update
through Vite and backend source changes restart through Node watch. Development data
lives in `target/web/study.sqlite`; set `STUDY_DATABASE` for isolated fixtures. Keep
existing data; the old seed/reset command is retired.

## Native checks are the exception

Use Tauri only when the task depends on native capabilities: OS file dialogs, microphone,
window management, updater or private process transport. Browser evidence cannot verify
those capabilities. Desktop/noVNC packages and manual helpers remain installed; the
devcontainer does not start the virtual desktop, noVNC or a viewer automatically.

Discover commands with `bun run`; helper arguments live in `.devcontainer/desktop/*.sh`.
Coordinate exclusive desktop control with the lead before launching or restarting it:

- `bun run run` launches Tauri in the foreground; `bun run desktop` restarts the managed
  Wayland desktop and app in the background. Neither starts noVNC.
- `bun run desktop-status` reports state and logs without launching anything.
  `bun run desktop-wait 120` waits for a window; `bun run desktop-watch` follows its log.
- `bun run desktop-attach` explicitly starts noVNC and prints its URL. Only use it when
  a remote native viewer is actually needed; manually forward container port 5900.
- `bun run desktop-shot`, `bun run desktop-click X Y` and `bun run desktop-record` capture
  and control the native app. Take coordinates from the latest screenshot.
- Source `target/desktop.env` before using `wtype`, `wlrctl` or `swaymsg` directly.
  `bun run desktop-browser` opens persistent container Chromium for native OAuth.
- `bun run desktop-screen <preset>` and `bun run desktop-window full|float|fullscreen`
  adjust native layout. `bun run desktop-stop` stops the native stack while keeping data.

The managed desktop owns its D-Bus session. Native logs and artifacts live under
`target/desktop`; `STUDY_LOG=debug bun run desktop-run` enables detailed logs at launch.
Never restart or stop another agent's app without coordination.

Model work requires the user's ChatGPT sign-in. Use existing material when unavailable
and report the limitation. Seeded E2E and capture generation are retired; keep existing
website assets intact. Package tests verify their covered behavior, and browser checks
verify the shared app; claim native behavior only after a native check.
