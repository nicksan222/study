---
name: ci-and-devcontainer
description: Use when changing Rust toolchain setup, Linux GUI dependencies, CI, or the development container.
---

# CI and development environment

- One devcontainer installs every tool. Add system dependencies to `.devcontainer/Dockerfile`,
  never inside recipes: GTK3, WebKitGTK 4.1, libsoup3, dbus, ALSA, compiler/linker and the
  optional sway/noVNC desktop. Keep it installed, but never auto-start it or its viewer.
  Node is pinned for Vite/Tauri; Bun runs the root development script and landing.
- Root frontend dependencies use `npm ci` and the committed `package-lock.json`. Landing
  uses Bun and its own lock. Vite+ supplies the local `vp` CLI, Oxfmt, Oxlint, Vite and
  frontend Vitest; keep its Vite alias and Vitest override aligned with the installed bundle.
  Root `vite.config.ts` owns format/lint policy for server, frontend, tests and tooling.
  Server tests run in Node and type checking stays with `tsc`.
  No browser/network install occurs during tests.
- Keep `.github/actions/setup`'s apt dependencies and Node/just pins aligned with Dockerfile.
  Rust comes from `rust-toolchain.toml`. Preserve `--locked` and `target/devcontainer`.
- `just check` includes Rust formatting, Clippy, dependencies, tests/doctests/docs, repository-wide Vite+ format/lint, frontend
  type/tests/build, generated database drift, tooling tests, server checks, and the
  landing Bun check. CI runs equivalent gates; `Test and build` is the required aggregate.
- The Rust browser bridge and its E2E/capture runners are retired. Use package tests for
  available behavior; do not claim full application parity during server integration.
- Use local web in the browser for roughly 99% of app work. Check localhost:5173 first;
  only start `bun dev` if Study is not already working locally. Reuse running servers.
  Forward port 5173 without opening tabs. Reserve `just run` and native desktop helpers
  for Tauri-specific behavior. noVNC starts only through explicit `just desktop-attach`;
  forward port 5900 manually when needed. Never stop another agent's server or desktop
  without coordination.
- Existing website captures are committed assets. Capture generation is unavailable.
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
- Update .github/CONTRIBUTING.md whenever build, run, check or release steps change.
