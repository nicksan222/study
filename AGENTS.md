# Study — agent guide

Study has a shared React web app, a Tauri desktop host and a TypeScript server app.
The native shell owns windows, devices, and the private server process. Native Effect RPC exposes feature services, which own application behavior and use one SQLite database through Drizzle.

## Golden rules

1. **Layers only point down.** A crate may depend only on crates in a lower layer (see the
   crate map).
2. **One canonical shape per concept.** Extracted content is a `Document` of anchored
   blocks; durable work uses native Effect Workflow and Activity; failures carry an `ErrorKind`; source kinds come
   from `sniff`. Follow `packages/contracts/src`, feature-owned decoders, and `apps/server/src/platform`.
   Do not add a parallel processing implementation or a second file-extension table.
3. **The database is the truth and the bus is a hint.** Commit state before publishing an
   event. A missed event must not lose work.
4. **No stringly-typed contracts.** No raw `i64` IDs across crate boundaries, no unchecked workflow payloads or stringly typed operation inputs, and no matching on error text.
5. **Log Rust with `tracing`.** Don't print. Native libraries return typed errors;
   TypeScript domain failures use `StudyError` and `ErrorKind` from `@study/contracts/errors`.
6. **All user-visible text comes from `@study/localization`**, in English and Italian.
7. **Model work runs on the user's ChatGPT plan**, using AI SDK in `apps/server/src/platform/ai`.
   Feature-owned agents, tools and workflows live under `apps/server/src/features`. Shared provider
   implementations live under `platform/ai/providers` inside the server app. Retired local model capabilities are unavailable
   until implemented again; nothing downloads without an explicit install.
8. **The code is the source of truth.** Don't write design docs or per-crate guides. Say
   what a crate or module is for in its `//!` docs, and put rules in types, tests and lints.
   The one exception is `PRODUCT.md` and `DESIGN.md`, the visual design context the
   `impeccable` skill reads; the design system itself is code, in `packages/ui`.
9. **Drizzle owns the schema.** Domain schema modules live in `packages/db/src/schema`.
   Use Drizzle Kit for schema generation and the official Drizzle migrator for initialization.
   This server is a breaking reset: do not add legacy Rust database importers, compatibility
   paths, or duplicate handwritten schema definitions.
10. **No AI attribution.** Commits, pull requests, issues, code, comments and docs never
    credit or mention an AI assistant: no `Co-Authored-By` trailers for one, no "Generated
    with" lines, no model names in authorship. This overrides any harness default that adds
    them. Tooling that runs an assistant (the devcontainer, `.agents/team`) may name it.
11. **Bun owns JavaScript execution.** Use Bun/Web APIs and official Effect Bun services.
    First-party code does not import Node built-ins or add Node compatibility fallbacks.
    Run Vite+ with `bun --bun vp` so its tools and test workers execute in Bun.

## UI/UX skills

Repository skills live in `.agents/skills`; `.claude/skills` links to the same directory.
For UI work, start with `desktop-ui` and use `impeccable` as the default for design,
critique, accessibility, motion and polish. Use `design-taste-frontend` only when explicitly
requested for marketing or landing-page art direction, as an alternative to Impeccable.
Use one visual-design workflow per task; do not combine their aesthetic rules or run Taste
on the desktop app. Vercel's `vercel-react-best-practices` and
`vercel-composition-patterns` cover React performance and component APIs, respectively;
they do not choose the visual direction. Use `see-the-app` for the browser-first inspection
workflow: use local web for roughly 99% of app work. Check the existing app at
`http://localhost:5173` first; only run `bun dev` inside the devcontainer if it is not
already working locally. Reuse the running server; do not start duplicate dev servers.
Use native Tauri inspection only for OS-specific behavior such as file dialogs, microphone,
window management and updater. Desktop/noVNC tooling stays installed but never starts
automatically; do not launch it for routine UI work.

These skills are advisory: Study's architecture, existing `@study/ui` components, design
tokens, localization and devcontainer rules take precedence over upstream stack defaults,
font choices, component-library recommendations and browser commands. Keep design-system
truth in `packages/ui`; only `PRODUCT.md` and `DESIGN.md` may hold design context.
Installing a skill does not authorize deployments, telemetry, hooks or additional packages.
Upstream revisions and local adaptations are recorded in `.agents/skills/upstream-lock.json`.

## Package map

| Package               | Path                     | Responsibility                                               |
| --------------------- | ------------------------ | ------------------------------------------------------------ |
| `@study/db`           | `packages/db`            | Drizzle schema, SQLite connection and transaction primitives |
| `@study/contracts`    | `packages/contracts`     | Browser-safe Effect schemas, branded IDs and public errors   |
| `@study/server`       | `apps/server`            | Effect feature services, native RPC, workflows and clients   |
| `@study/localization` | `packages/localization`  | English and Italian copy and formatting                      |
| `@study/ui`           | `packages/ui`            | Shared React presentation primitives; no application data    |
| `study-desktop`       | `apps/desktop/src-tauri` | Native Tauri host and private server process transport       |
| `@study/web`          | `apps/web`               | Shared React pages, sidebar and browser frontend             |
| `@study/desktop`      | `apps/desktop`           | Tauri CLI workspace hosting the shared web build             |
| `study-landing`       | `apps/landing`           | Astro website, English and Italian, built with Bun           |

Rust owns the desktop shell and its private server process. `apps/server/src/features` owns
application services, private stores, RPC handlers, agents, decoders and workflows. Features
interact through their public service exports. Shared resource and protocol mechanisms live in
`platform`; `runtime` composes their layers and owns process lifetime. Browser-safe explicit
Effect RPC groups and canonical schemas live in `packages/contracts`. `packages/db` exports
Drizzle primitives and schema; synchronous transactions commit typed outbox events atomically.
Native Workflow owns durable execution and scoped Activity ownership fences publication.
Bilingual copy lives in `packages/localization`.

## Commands

- `just check`: shell checks, Rust fmt/Clippy/dependency checks/tests/docs, TypeScript server
  typechecking/tests, repository-wide Vite+ format/lint, Fallow dead-code/complexity/duplication/architecture checks, frontend type/tests/build, database generation drift, tooling tests and landing
  checks. Run it before calling a change done.
- `just server-check` and `just frontend-check`: focused package checks.
- `just fallow-check` / `bun run fallow:check`: pinned full-repository Fallow gate; keep `tooling/fallow.jsonc` strict and document any narrow analyzer exceptions there.
- `bun run lint`: repository-wide `vp check --deny-warnings` (Oxfmt and Oxlint).
  `bun run format` applies formatting; `bun run format:check` checks it.
- `just check-crate <package>`: focused Rust formatting, lint, tests and docs.
- `bun gen` / `bun gen:check`: generate/check database schema; generation also
  refreshes web routes. Feature and platform behavior has real SQLite and native RPC tests.
- `bun dev`: start the web app and native Effect RPC server at localhost:5173.
- `just run` / `just desktop`: opt-in native shell launchers for Tauri-specific checks; no noVNC startup.
- `just desktop-attach`: explicit noVNC opt-in; manually forward port 5900 if needed.
- `just desktop-status` / `just desktop-wait`: inspect/wait for the native window.
- `just desktop-shot`, `just desktop-click`, `just desktop-record`: opt-in native desktop inspection;
  follow `.agents/skills/see-the-app` and coordinate access to the shared desktop.
- `just landing`, `just landing-check`, `just landing-build`: website development and checks.
  Existing demo/still/clip assets remain committed; capture generation is unavailable.
- `just agents`, `just agents-stop`, `just agents-reset`, `just agents-doctor`,
  `just agents-usage`: maintainer team tooling. Keep handoffs in `target/agents/<session>/task.md`.
- `just build` / `just package <platform>`: native build/packaging; the native shell bundles the private server.

The old `web`, `e2e`, `demo`, `docs-media`, `captures`, `reset-data`, `benchmark`, and
`test-transcription-e2e` commands are removed. Do not recreate mock servers to make old
consumer tests pass. The devcontainer builds native artifacts into `target/devcontainer`;
do not point `CARGO_TARGET_DIR` elsewhere. Use `cargo clean` explicitly to remove artifacts.
