# Study — agent guide

Study has a shared React client, a Tauri desktop host and a TypeScript server app.
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
   `PRODUCT.md` and `DESIGN.md` hold the visual design context the `impeccable` skill
   reads; the design system itself is code, in `packages/ui`. Accepted architecture
   decisions belong in `doc/adr`, following
   [Architecture decision records](doc/adr/architecture-decision-records.md).
   Do not add speculative design or plan docs.
9. **Drizzle owns domain schema.** Domain schema modules live in `packages/db/src/schema`.
   Official Effect SQL infrastructure owns its prefixed execution tables and migrations in
   the same SQLite database. Neither migrator may duplicate or alter the other owner's schema;
   startup and restore validate both before accepting work.
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
| `@study/client`       | `apps/client`            | Shared React frontend for browser and desktop                |
| `@study/desktop`      | `apps/desktop`           | Tauri CLI workspace hosting the shared client build          |
| `study-landing`       | `apps/landing`           | Astro website, English and Italian, built with Bun           |

Rust owns the desktop shell and its private server process. `apps/server/src/features` owns
application services, private stores, RPC handlers, agents, decoders and workflows. Features
interact through their public service exports. Shared resource and protocol mechanisms live in
`platform`; `runtime` composes their layers and owns process lifetime. Browser-safe explicit
Effect RPC groups and canonical schemas live in `packages/contracts`. `packages/db` exports
Drizzle primitives and schema; synchronous transactions commit typed outbox events atomically.
Native Workflow owns durable execution and scoped Activity ownership fences publication.
Bilingual copy lives in `packages/localization`.

## Deliver complete changes

- Before editing, identify the intended user outcome, the existing owner of the behavior,
  and what evidence would demonstrate success. Keep the implementation proportional to the
  request; include every necessary consumer, but leave unrelated cleanup out.
- Check all applicable entry points: navigation, settings, menus, shortcuts and programmatic
  callers. Shared browser behavior and Tauri capabilities need separate consideration;
  browser verification does not establish native behavior.
- Follow the lifecycle through creation, use, cancellation or reversal, failure and recovery.
  Check reopening and restart persistence when state is durable. Make unsupported paths
  explicit rather than leaving a control that appears to work.
- Check English and Italian, keyboard and focus behavior, relevant viewport sizes, and
  loading, empty and error states for interface changes. Reuse `@study/ui` primitives;
  shared visual treatments belong in their variants or composition, not call-site overrides.
- Put application behavior in the feature service that owns it. Transport handlers decode,
  call the service and translate errors; retries, persistence and rollback belong below
  that boundary. A move updates all consumers and removes obsolete code.

## Evidence and verification

- Choose evidence for the claim. New features need an observed end-to-end outcome;
  refactors need evidence that behavior is preserved; bug fixes need evidence of the
  original failure and the corrected behavior. Formatting-only changes need formatting
  verification. Do not claim more than the check exercised.
- For logic, data, state or protocol bugs, reproduce the failure with a focused regression
  test before fixing it. Extend an existing case or table where it fits, at the lowest
  useful layer. Avoid duplicate coverage, mock-call mirrors and assertions on behavior
  already guaranteed by types.
- For purely visual changes, capture the relevant before and after states. Use a short
  recording when interaction or motion is the evidence; do not add a test just to assert
  spacing or copy. Behavior that depends on browser focus, scrolling or input belongs in
  browser verification. Run one integrated pass after assembling a user-visible change.
- Use real application services and isolated data for integrated checks. A failed setup,
  missing sign-in or unreachable control is a verification limitation, not a reproduced
  product failure or a passing check. Never reset existing user data to prepare a test.
- Synchronize asynchronous tests on observable state, events or completion signals; use
  Effect's test clock for time-dependent behavior. Do not hide races with fixed sleeps,
  polling loops, retries or larger timeouts. Use the browser runner's assertion waiting
  for browser state.
- Performance claims name the workload, baseline, measurement and limits. Measure the
  affected production path with representative data; smaller payloads alone do not prove
  lower memory use or faster rendering. Keep repeatable budgets in existing focused tests
  where practical.
- Changes to prompts, model tools or generated learning material need representative
  examples and explicit quality criteria in addition to typechecks. Include ordinary
  cases that catch overcorrection, compare on the same model and settings, and report
  variability and usage. Follow the ChatGPT-plan rule; do not add a separate paid API
  dependency or treat recorded output as proof of live model quality.
- During iteration use focused checks or `bun run check:changed`; the full `bun run check`
  remains required before completion. Report the commands, observed outcomes, evidence
  paths and anything unverified. A green check supports only its covered behavior.

## Review and handoff

- Review changed behavior and affected consumers against the requirements and architecture.
  Findings identify a concrete failure or violated rule, the relevant code and a specific
  correction. Separate demonstrated defects from suggestions; avoid unrelated cleanup and
  aesthetic preferences presented as blockers.
- Call out changed product defaults, migrations and any new or broadened diagnostic
  suppression. Fix the underlying issue where possible; any necessary exception needs a
  narrow scope and a reason. Passing checks after weakening them is not equivalent evidence.
- Final handoffs report the outcome, verification, evidence links and material limitations.
  Pull request descriptions explain intent, resulting behavior, implementation, consequential
  decisions and their rationale, trade-offs and lifecycle implications so a reviewer can
  assess the proposal without first reading the diff. Scale detail to the change and follow
  the PR template; CI reports check status, so omit passing-test lists and compliance
  checklists from the description. Keep temporary screenshots, recordings and working notes
  outside tracked source; committed visual test references and product assets are separate
  from review-only evidence.
- Update existing guidance when a change makes it inaccurate. Do not narrate code, retain
  a second implementation checklist, or add a rule already enforced by a type or lint
  without explaining a constraint the code cannot show. Keep `AGENTS.md` broadly applicable;
  specialized operating procedures belong in the existing repository skills, and accepted
  architectural reasoning belongs in `doc/adr`.

## Commands

- `bun run check`: shell checks, Rust fmt/Clippy/dependency checks/tests/docs, TypeScript server
  typechecking/tests, repository-wide Vite+ format/lint, Fallow dead-code/complexity/duplication/architecture checks, frontend type/tests/build, database generation drift, tooling tests and landing
  checks. Run it before calling a change done.
- `bun run server-check` and `bun run frontend-check`: focused package checks.
- `bun run fallow-check` / `bun run fallow:check`: pinned full-repository Fallow gate; keep `tooling/fallow.jsonc` strict and document any narrow analyzer exceptions there.
- `bun run lint`: repository-wide `vp check --deny-warnings` (Oxfmt and Oxlint).
  `bun run format` applies formatting; `bun run format:check` checks it.
- `bun run check-crate <package>`: focused Rust formatting, lint, tests and docs.
- `bun gen` / `bun gen:check`: generate/check database schema; generation also
  refreshes web routes. Feature and platform behavior has real SQLite and native RPC tests.
- `bun dev`: start the web app and native Effect RPC server at localhost:5173.
- `bun run run` / `bun run desktop`: opt-in native shell launchers for Tauri-specific checks; no noVNC startup.
- `bun run desktop-attach`: explicit noVNC opt-in; manually forward port 5900 if needed.
- `bun run desktop-status` / `bun run desktop-wait`: inspect/wait for the native window.
- `bun run desktop-shot`, `bun run desktop-click`, `bun run desktop-record`: opt-in native desktop inspection;
  follow `.agents/skills/see-the-app` and coordinate access to the shared desktop.
- `bun run landing`, `bun run landing-check`, `bun run landing-build`: website development and checks.
  Existing demo/still/clip assets remain committed; capture generation is unavailable.
- `bun run agents`, `bun run agents-stop`, `bun run agents-reset`, `bun run agents-doctor`,
  `bun run agents-usage`: maintainer team tooling. Keep handoffs in `target/agents/<session>/task.md`.
- `bun run desktop:build` / `bun run package <platform>`: native build/packaging; the native shell bundles the private server.

The old `web`, `e2e`, `demo`, `docs-media`, `captures`, `reset-data`, `benchmark`, and
`test-transcription-e2e` commands are removed. Do not recreate mock servers to make old
consumer tests pass. The devcontainer builds native artifacts into `target/devcontainer`;
do not point `CARGO_TARGET_DIR` elsewhere. Use `cargo clean` explicitly to remove artifacts.

`bun run check:changed` uses Turbo to check affected packages and consumers; append `--dry`
to preview. `bun run test`, `bun run typecheck`, and `bun run build` also use Turbo.
Deterministic unit tests, typechecks and web builds use local caching; server/database,
browser journeys, integrations and tooling tests always execute. Run `bun run check` before
calling a change done; CI remains the full verification gate.
