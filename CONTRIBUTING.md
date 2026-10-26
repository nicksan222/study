# Contributing

Thank you for helping with Study.

## The rules

- **Read [AGENTS.md](AGENTS.md) first.** Its golden rules, crate map and commands apply to
  people as much as to agents. Everything else is in the code, beginning with each crate's
  `src/lib.rs`.
- **One branch per change.** Open a pull request to `main`; nothing goes to `main` directly.
- **Run `just check` before you push.** It is what CI runs: formatting, Clippy with warnings
  denied, Rust tests/doctests/docs, frontend type/lint/tests/build, generated protocol drift,
  tooling tests, real browser consumer E2E, and the website's Bun type check. Some Rust tests
  run real services in Docker.
- **Every visible word comes from `study-localization`, in English and Italian.** If you
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

Then run the app:

```sh
npm ci
npx playwright install chromium
just reset-data   # a development database with sample projects
just run
```

`just run` starts a virtual desktop and opens it in your host browser (in a plain container
terminal, open the printed link yourself). Ctrl+C stops the app; `just desktop-attach`
reconnects; `just desktop-stop` stops the desktop and keeps its data. The port is bound to
your loopback interface only.

Sign-in pages open in Chromium inside that desktop, so the OAuth callback stays in the
container. The browser profile (`target/desktop/browser-profile`) and the development data
(`target/dev-data`) survive container rebuilds. This is the Linux app; it does not validate a
native macOS build, and host microphones are not forwarded.

### On your own Linux machine

The native shell uses Tauri 2 with WebKitGTK 4.1. On Debian or Ubuntu:

```sh
sudo apt install build-essential pkg-config clang libfontconfig-dev libwayland-dev \
  libxkbcommon-x11-dev libx11-xcb-dev libssl-dev libzstd-dev libvulkan1 \
  libasound2-dev mesa-vulkan-drivers ffmpeg libgtk-3-dev libwebkit2gtk-4.1-dev \
  libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev dbus-x11 protobuf-compiler sway
```

Install Rust with [rustup](https://rustup.rs) (`rust-toolchain.toml` picks the version) and
[just](https://github.com/casey/just), Node 26 and Bun (for landing). Run `npm ci`,
`npx playwright install chromium`, then `just reset-data` and `just run`. The first build
takes a while, and `target/` can grow to 40 GB. `just check` also needs Docker. Its desktop IPC tests use `swaymsg` from the `sway` package.
The Devcontainer workflow can also be run manually in GitHub Actions to build and start the
image independently of its path filters.

Close Study before `just reset-data`; a shared data lock keeps app runs and reseeding apart.

### Everyday commands

For web development in the devcontainer, run `bun dev` from the repository root.
It starts the real RPC backend, waits until it is ready, then starts Vite with hot reload
at `http://localhost:5173`. Ctrl+C stops both. The development database is kept between runs.
Use `bun dev --port 5174` to choose another frontend port.
The root Bun scripts delegate to Just recipes; `just --list` lists all tasks. Bash scripts
under `tooling/` handle service lifetimes, protocol generation, and release verification.
The TypeScript helpers only parse source files and check project conventions.

| Command | What it does |
|---|---|
| `just run` | Run Study on the browser desktop, keeping the development database. |
| `bun dev` / `just web` | Start the web frontend and real gRPC backend together at localhost:5173. |
| `just e2e` | Browser CRUD/settings/study flows with an isolated real backend per test. |
| `bun run demo:record` | Record the web demo tour to `apps/landing/public/demo.gif`. |
| `just desktop-status` | Inspect the native window and log path without restarting. |
| `just desktop-wait` | Wait for the native window. |
| `just reset-data` | Replace the development database with sample data. |
| `just check` | Everything CI runs. |
| `just check-crate <package>` | `just check` for one package. |
| `just --list` | Every other command. |

## Where data lives

- `~/.local/share/study/`: the database (`study.sqlite3`) and `diagnostics.log`.
- `~/.cache/study/models/`: the local speech-to-text (about 670 MB) and search (about 135 MB)
  models.

Both follow `XDG_DATA_HOME` and `XDG_CACHE_HOME`. `just run` uses `target/dev-data` instead.

## Captures of the app

The README demo and website stills/clips use the same production React components as the
native app, driven by Playwright through the generated protobuf client and real Rust gRPC
backend. Every capture gets a fresh seeded fixture database; no model or sign-in is needed.
From the repository root, run:

```sh
bun run demo:record
# Optional output path (GIF):
bun run demo:record target/demo.gif
```

The recorder starts and stops its own production web frontend and backend, drives the tour,
and writes `apps/landing/public/demo.gif` by default. It needs the development tools,
Playwright Chromium and FFmpeg installed by the devcontainer; no running app is required.
`just demo` runs the same recorder. `just docs-media` refreshes website media, and
`just captures` makes both. Arguments to `just docs-media` filter scene names,
language/theme variants, or `missing`.
Scenes live in `tooling/e2e/tests/captures.spec.ts`; `study-showcase` delegates to that
consumer. The Captures workflow opens a pull request for refreshed committed assets.

Browser tests allocate a session with `/rpc/__study/session`, select it using the
`x-study-session` transport header, and release it in teardown. The development bridge is
never packaged. Tests drive the actual frontend; route interception and fake RPC responses
are forbidden. `target/e2e` contains retained failure traces, screenshots and video. Native
smoke checks remain necessary for OS dialogs, microphone and updater integration.

## The agent team

The devcontainer mounts your AI logins and ships an optional team of agents for
maintainers: lead, developer, PM, QA, student, reviewer and pushback.

| Command | What it does |
|---|---|
| `just agents-doctor` | Check tools and subscription login, without a model request. |
| `just agents` | Open the team, keeping existing conversations. |
| `just agents lead developer --no-attach` | Start only some roles. |
| `just agents-reset` | Start fresh conversations and clear the task checkpoint. |
| `just agents-stop` | Stop the team. |
| `just agents-usage --hours 24` | Local token counts, not remaining allowance. |

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

To attach a demo to a pull request, record with `just desktop-record`, then
`just showcase target/desktop/clip.mp4 target/desktop/showcase.mp4` (15 seconds at most,
8 MB at most).

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
not supported because the local ONNX Runtime has no matching build.

`just package linux-x86_64` (or `linux-aarch64`, `macos-aarch64`, `windows-x86_64`) invokes
Tauri on a matching native runner; signed builds require the same updater key environment as CI. Output lives beneath the Cargo target directory's
platform `release/bundle` directory. CI uses the same Tauri config at
`apps/desktop/src-tauri/tauri.conf.json`, with no cargo-packager dependency.

## License

Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in Study, as defined in the Apache-2.0 license, is dual licensed under
[Apache 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), without any additional terms or
conditions.
