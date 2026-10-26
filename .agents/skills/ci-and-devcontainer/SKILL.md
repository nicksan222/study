---
name: ci-and-devcontainer
description: Use when changing Rust toolchain setup, Linux GUI dependencies, CI, or the development container.
---

# CI and development environment

- One devcontainer installs every tool. Add system dependencies to `.devcontainer/Dockerfile`,
  never inside recipes: GTK3, WebKitGTK 4.1, libsoup3, dbus, ALSA, compiler/linker and the
  sway/noVNC desktop. Node is pinned for Vite/Tauri; Bun is pinned for landing only.
- Root frontend dependencies use `npm ci` and the committed `package-lock.json`. Landing
  uses Bun and its own lock. Install Chromium once with `npx playwright install chromium`;
  CI uses `--with-deps`. No browser/network install occurs during tests.
- Keep `.github/actions/setup`'s apt dependencies and Node/just pins aligned with Dockerfile.
  Rust comes from `rust-toolchain.toml`. Preserve `--locked` and `target/devcontainer`.
- `just check` includes Rust formatting, Clippy, dependencies, tests/doctests/docs, frontend
  type/lint/tests/build, generated protocol drift, tooling tests, real consumer E2E, and the
  landing Bun check. CI runs equivalent gates; `Test and build` is the required aggregate.
- Browser E2E runs the production React components and real generated tonic client/backend.
  Each test owns a seeded fixture capability/database and cleanup. Never mock transport or
  duplicate domain handlers. Native smoke uses the shared sway desktop separately.
- `just run` launches Tauri/Vite on the virtual desktop. `desktop-status`, `desktop-wait`,
  `desktop-shot`, `desktop-click`, `desktop-record` work for agents. Never stop another
  agent's build or desktop without coordination. Keep host viewer and OAuth browser apart.
- Captures use the production UI through isolated real RPC fixtures in `tooling/e2e`.
  `study-showcase` delegates to that consumer; the production frontend is the sole UI.
- Release uses Tauri bundling and tauri-action on native Linux/macOS/Windows runners.
  `apps/desktop/src-tauri/tauri.conf.json` owns packaging; `createUpdaterArtifacts` produces
  signed updater assets. Platform jobs retain isolated artifacts; `tooling/release` verifies
  every signature and the four-platform set, preserves stable website download names, and
  writes the updater feed once. The macOS runner inspects the built app signature for the
  configured audio-input entitlement and its microphone privacy description. A single
  publisher clears the draft only after validation. Secrets are
  `TAURI_SIGNING_PRIVATE_KEY`, optional password, and Apple signing/notarization credentials;
  `STUDY_UPDATE_PUBLIC_KEY` is public configuration. Never bake secrets into the image.
- Preserve the mounted host Claude/Codex/GitHub credentials and Herdr setup. `.devcontainer/
  post-create.py` configures those logins at runtime; `.agents/team` remains one project-wide
  team. Claude skills link to `.agents/skills`; `CLAUDE.md` imports `AGENTS.md`.
- Update CONTRIBUTING.md whenever build, run, check or release steps change.
