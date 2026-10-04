# Contributing

Thank you for helping with Study.

## The rules

- **Read [AGENTS.md](AGENTS.md) first.** Its golden rules, crate map and commands apply to
  people as much as to agents. Everything else is in the code, beginning with each crate's
  `src/lib.rs`.
- **One branch per change.** Open a pull request to `main`; nothing goes to `main` directly.
- **Run `just check` before you push.** It is what CI runs: formatting, Clippy with warnings
  denied, every test and the API docs. Some tests run real services in Docker.
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

You need glibc 2.38 or newer. On Debian or Ubuntu:

```sh
sudo apt install build-essential pkg-config clang libfontconfig-dev libwayland-dev \
  libxkbcommon-x11-dev libx11-xcb-dev libssl-dev libzstd-dev libvulkan1 \
  libasound2-dev mesa-vulkan-drivers ffmpeg
```

Install Rust with [rustup](https://rustup.rs) (`rust-toolchain.toml` picks the version) and
[just](https://github.com/casey/just), then `just reset-data` and `just run`. The first build
takes a while, and `target/` can grow to 40 GB. `just check` also needs Docker.

Close Study before `just reset-data`; a shared data lock keeps app runs and reseeding apart.

### Everyday commands

| Command | What it does |
|---|---|
| `just run` | Run Study on the browser desktop, keeping the development database. |
| `just reset-data` | Replace the development database with sample data. |
| `just check` | Everything CI runs. |
| `just check-crate <package>` | `just check` for one package. |
| `just --list` | Every other command. |

## Where data lives

- `~/.local/share/study/`: the database (`study.sqlite3`) and `diagnostics.log`.
- `~/.cache/study/models/`: the local speech-to-text (about 670 MB) and search (about 135 MB)
  models.

Both follow `XDG_DATA_HOME` and `XDG_CACHE_HOME`. `just run` uses `target/dev-data` instead.

## The README demo

The demo GIF is recorded by hand. Run the Demo workflow from the Actions tab; it records
`assets/demo.gif` with `just demo` from sample data and opens a pull request with the new GIF.
Edit the tour in `crates/study-showcase/src/tour.rs`.

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
(commits, pushes and opens the pull request, never merges). These three share one slot.

Models and roles live in `.agents/team/fleet.toml`, the working agreement in
`.agents/team/team.md`, and each role's checklist in `.agents/team/roles/`. The handoff is
kept in `target/agents/<session>/task.md`. Publishing needs an HTTPS GitHub remote and a
login with push access; host credentials are forwarded at container start, never baked into
the image.

To attach a demo to a pull request, record with `just desktop-record`, then
`just showcase target/desktop/clip.mp4 target/desktop/showcase.mp4` (15 seconds at most,
8 MB at most).

## Releases

Bump `version` in the workspace `Cargo.toml`, commit, then push a matching tag:
`git tag v0.2.0 && git push origin v0.2.0`. The workflow refuses a tag that does not match
the workspace version, builds all four signed packages, and publishes the release only when
every one exists, with signatures, `SHA256SUMS` and the `latest.json` update feed. A failed
build can be rerun from Actions.

One-time repository setup, using the pinned `cargo packager` in the devcontainer:

1. Run `cargo packager signer generate --path /secure/location/study.key` and keep a secure
   backup of the key and its password. Never commit this file.
2. Set the repository variable `STUDY_UPDATE_PUBLIC_KEY` to the `.pub` file's contents, the
   secret `CARGO_PACKAGER_SIGN_PRIVATE_KEY` to the private key, and
   `CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD` to its password (omit only for an unencrypted
   key).
3. Allow Actions to write repository contents.

For notarized macOS packages, also set `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE` (base64
P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password) and
`APPLE_TEAM_ID`. Without them macOS packages are unsigned. Windows installers are unsigned
and can trigger SmartScreen. Intel Macs are not supported: ONNX Runtime ships no build for
them.

For a local signed package, export the variables above, set
`STUDY_UPDATE_ENDPOINT=https://github.com/OWNER/REPO/releases/latest/download/latest.json`,
and run `just package linux-x86_64` (or the matching native platform).

## License

Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in Study, as defined in the Apache-2.0 license, is dual licensed under
[Apache 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), without any additional terms or
conditions.
