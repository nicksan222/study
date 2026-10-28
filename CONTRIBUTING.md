# Contributing

Thank you for helping with Study.

## The rules

- **Read [AGENTS.md](AGENTS.md) first.** Its golden rules, crate map and commands apply to
  people as much as to agents. Everything else is in the code, beginning with each crate's
  `src/lib.rs`.
- **One branch per change.** Open a pull request to `main`; nothing goes to `main` directly.
- **Run `just check` before you push.** It is what CI runs: formatting, Clippy with warnings
  denied, Rust tests/doctests/docs, repository-wide Vite+ format/lint, frontend type/tests/build, generated database drift,
  tooling tests, backend package checks, and the website's Bun type check. CI runs equivalent gates as sequential, emoji-labeled steps in its required
  `Test and build` job, with readable test output and a results table in the run summary.
  After setup, every gate runs even if an earlier check fails.
- **Every visible word comes from `@study/localization`, in English and Italian.** If you
  can't write the Italian, say so in the pull request.
- **Report a vulnerability privately**, as [SECURITY.md](SECURITY.md) says, never in an
  issue.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

### In the devcontainer (recommended)

The devcontainer (`.devcontainer/`) installs every tool. Open the folder in VS Code and
reopen it in the container, or use the devcontainer CLI:

```sh
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . bash
```

The devcontainer installs root and landing dependencies from their committed locks. To
refresh them, run `npm ci` and `bun install --cwd apps/landing --frozen-lockfile`, then
run `just check`. The former Rust
backend and browser bridge have been retired; the replacement backend does not yet provide
all application features, and seeded browser E2E and capture generation are unavailable.

### On your own Linux machine

The native shell uses Tauri 2 with WebKitGTK 4.1. On Debian or Ubuntu:

```sh
sudo apt install build-essential pkg-config clang libfontconfig-dev libwayland-dev \
  libxkbcommon-x11-dev libx11-xcb-dev libssl-dev libzstd-dev libvulkan1 \
  libasound2-dev mesa-vulkan-drivers ffmpeg libgtk-3-dev libwebkit2gtk-4.1-dev \
  libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev dbus-x11 sway
```

Install Rust with [rustup](https://rustup.rs) (`rust-toolchain.toml` picks the version) and
[just](https://github.com/casey/just), Node 26 and Bun (for landing). Run `npm ci` and
`bun install --cwd apps/landing --frozen-lockfile`, then `just check`. The first build takes a while. Use `cargo clean` when you explicitly want to remove native build artifacts;
development commands do not prune the Cargo cache automatically. Desktop IPC tests use `swaymsg` from the `sway` package.
The Devcontainer workflow can also be run manually in GitHub Actions to build and start the
image independently of its path filters.

### Everyday commands

Run `bun dev` from the repository root to start the web app and tRPC backend at
`http://localhost:5173`. Development data lives in `target/web/study.sqlite`; set
`STUDY_DATABASE` to use another database. `just run` starts the desktop host of the same app.

The root scripts and Just recipes share the project commands; `just --list` lists all tasks. Web Vite, router and TypeScript
configs live in `apps/web`; shared TypeScript settings live in `tooling/typescript`.
Rust lint and dependency policy live in `tooling/rust`; `.cargo/config.toml` points Clippy
there for both recipes and direct Cargo invocations. Root npm scripts select the web
workspace and backend TypeScript config. Vite+ (`vp`) owns web development, builds,
frontend Vitest, formatting (Oxfmt), and linting (Oxlint). Root `vite.config.ts` imports the
shared policies from `tooling/oxc-config`; these apply to backend, frontend, tests and tooling.
Run `npm run format` to format, `npm run format:check` to check formatting, and `npm run lint`
for the combined format/lint gate with warnings denied. Backend tests keep the actual Node
runtime (`npm run backend:test`) with the spec reporter; frontend tests use the verbose
Vitest reporter. TypeScript checks keep `tsc`.
Run `bun gen` from the workspace root to generate database migrations and desktop routes.
Run `bun gen:check` to check generated database outputs
without changing the database schema. The equivalent Just recipes are `just gen` and
`just gen-check`.
Desktop inspection recipes call `swaymsg` and `jq` directly. The scripts in
`.devcontainer/desktop/` manage the virtual desktop; `lifecycle.py` owns private D-Bus
startup, reuse and shutdown, plus bounded process waiting. Desktop commands need no
Node package or Cargo build.

| Command                      | What it does                                               |
| ---------------------------- | ---------------------------------------------------------- |
| `just desktop-status`        | Inspect the native window and log path without restarting. |
| `just desktop-wait`          | Wait for the native window.                                |
| `just check`                 | Everything CI runs.                                        |
| `just check-crate <package>` | `just check` for one package.                              |
| `just --list`                | Every other command.                                       |

## Where data lives

- `~/.local/share/study/`: the database (`study.sqlite3`) and `diagnostics.log`.
- Existing local-model caches may remain from earlier releases; the retired backend no
  longer installs or uses them.

Existing data is retained. Native development selects `target/dev-data`; no reset or seed
command is provided during the backend transition.

## Captures of the app

The README demo and website stills and clips are committed from an earlier release.
The former capture runner was retired with the Rust backend.

## The agent team

The devcontainer mounts your AI logins and ships an optional team of agents for
maintainers: lead, developer, PM, QA, student, reviewer and pushback.

| Command                                  | What it does                                                 |
| ---------------------------------------- | ------------------------------------------------------------ |
| `just agents-doctor`                     | Check tools and subscription login, without a model request. |
| `just agents`                            | Open the team, keeping existing conversations.               |
| `just agents lead developer --no-attach` | Start only some roles.                                       |
| `just agents-reset`                      | Start fresh conversations and clear the task checkpoint.     |
| `just agents-stop`                       | Stop the team.                                               |
| `just agents-usage --hours 24`           | Local token counts, not remaining allowance.                 |

Give the lead the task. It splits the change into small slices, each built and reviewed on
its own; QA and `just check` run once on the result. On demand it starts `scenario` (seeded
test states), `upgrade-reviewer` (does an existing install still work?) and `pr-maker`
(commits, pushes and opens the pull request, never merges), and `site` keeps the website in
`apps/landing/` in step with the app, in English and Italian. These four share one slot.

Models and roles live in `.agents/team/fleet.toml`, the working agreement in
`.agents/team/team.md`, and each role's checklist in `.agents/team/roles/`. The handoff is
kept in `target/agents/<session>/task.md`. Publishing needs an HTTPS GitHub remote and a
login with push access; host credentials are forwarded at container start, never baked into
the image.

## Releases

Bump the workspace version and Tauri config version together, then push a matching `vX.Y.Z`
tag. The release checks that tag, builds Tauri packages on Linux x64/ARM64, macOS Apple
Silicon and Windows x64. Each build retains its signed bundles as an isolated Actions
artifact. `tooling/release/release.sh` then verifies every updater with Minisign, checks
all four platform/version/file digests, preserves the website's stable download names,
and writes `latest.json` once. A single publisher uploads the complete set and clears the
draft only after that validation. Published releases are immutable to retries.

Generate a signing key using `npx tauri signer generate -w /secure/location/study.key`.
Keep a secure backup; never commit it. Set the repository variable `STUDY_UPDATE_PUBLIC_KEY`
to the base64 encoded public key printed by Tauri (not raw Minisign text), secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the private key/password, and allow Actions to
write release contents. The release preflight merges that same public key and endpoint into
Tauri's effective bundler configuration; the app reads the embedded configuration.
For local bundles without signing credentials, use `just package linux-x86_64 --unsigned`.
This explicitly disables updater artifacts and signing for that build.

For notarized macOS packages, also set `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`
(base64 P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`.
The macOS build verifies the produced app's signed audio-input entitlement and microphone
privacy description before its artifacts can reach publication. The entitlement lives beside
Tauri's configuration and is retained in the effective signed configuration. Without Apple
credentials, packaging uses ad-hoc signing so that entitlement is still embedded; a supplied
certificate can provide its own identity. Distribution signing and notarization use the
Apple credentials above.
Windows installers need separate platform signing credentials if desired. Intel Macs are
not part of the current release target set.

`just package linux-x86_64` (or `linux-aarch64`, `macos-aarch64`, `windows-x86_64`) invokes
Tauri on a matching native runner; signed builds require the same updater key environment as CI. Output lives beneath the Cargo target directory's
platform `release/bundle` directory. CI uses the same Tauri config at
`apps/desktop/src-tauri/tauri.conf.json`, with no cargo-packager dependency.

## License

Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in Study, as defined in the Apache-2.0 license, is dual licensed under
[Apache 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), without any additional terms or
conditions.

The TypeScript backend uses Drizzle with schema modules in `packages/db/src/schema`.
Run `bun gen` after changing the schema and `bun gen:check` to check drift.
`packages/backend` owns the tRPC router and inferred client contract; it needs no code generation.
Desktop, CLI, and web clients use the same typed procedures.

`@study/db` exports `Db` and the schema; it contains no business rules. Procedures live in
`packages/backend`, grouped by domain with input validation and a sibling `.test.ts` for each
operation. Tests use fresh SQLite databases and actual services. `packages/backend/src/runtime/main.ts`
starts and stops the backend process. The app is local only; ChatGPT provider sign-in is retained.
