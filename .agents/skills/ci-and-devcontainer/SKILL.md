---
name: ci-and-devcontainer
description: Use when changing Rust toolchain setup, Linux GUI dependencies, CI, or the development container.
---

# CI and development environment

- **One complete devcontainer.** `.devcontainer/Dockerfile` installs Study's build,
  rendering and PDF dependencies, the browser desktop, Rust tools, and the agent
  tools (Node, pinned Claude Code, Herdr and reviewr, Codex, basedpyright and
  GitHub CLI). `.devcontainer/devcontainer.json` is the only configuration.
  `just agents` must work there after a rebuild. Linux CI and Linux releases use it too.
  Add tools to the Dockerfile, never in a recipe.
- **`post-create.py` configures mounted host credentials** at runtime:
  - Herdr's Claude integration, with a `$HOME`-relative hook;
  - Claude Code's trust dialog, accepted for the workspace, so agents start unattended;
  - the gh token for shells, git pushing through gh, and the exported host author identity;
  - the Claude Code plugins every agent uses, declared in `.claude/settings.json`
    (`extraKnownMarketplaces` and `enabledPlugins`). Add a plugin there, never by hand.
- **The `Justfile` only runs things.** It assumes the tools are installed; CI and release
  Linux workflows invoke `just` recipes. Native macOS and Windows release jobs invoke
  the same Python packaging scripts directly; their tools are pinned in the release workflow.
- **CI runs only inside the devcontainer, Linux,** through `devcontainers/ci`: one image, one
  package list, the same as the agents use. No workflow step installs a toolchain, an apt
  package or `just`; checkout, caching and the action are all there is.
  - The image's layers are cached in the GitHub Actions cache (Buildx `type=gha`, one scope
    per runner architecture) after every build, passing or not; `main` also pushes the
    image to GHCR as `study-devcontainer`.
  - Docker-in-Docker (a devcontainer feature) runs the tests that need real services.
  - The runner's rust-cache keeps the container's `target/devcontainer`; `actions/cache`
    keeps its crate downloads in `target/cargo-home`. Both sit inside the workspace. Never
    point the runner's `CARGO_HOME` into the workspace: rust-cache then drops every
    compiled dependency, since it keeps only crates whose sources sit outside it.
  - Releases are the native-runner exception: Linux x64 and ARM64 use this image;
    macOS Intel/Apple Silicon and Windows x64 use native GitHub runners. They install
    Rust and pinned cargo-packager; they must never require a second devcontainer.
  - Linux AppImages still need glibc 2.41 or newer.
- **One release pipeline.** `.github/workflows/release.yml` runs on a pushed `vX.Y.Z` tag
  that matches the workspace version, then publishes only when all five signed packages exist.
  `packaging/packager.json` and `packaging/release.sh` own packaging and the
  static `latest.json` updater feed; keep the platform keys aligned with cargo-packager-updater.
  Keep `cargo-packager` pinned identically in the Dockerfile and release workflow.
  Never put signing keys in the image or repository. Releases require the public-key
  repository variable and private-key secret described in README; normal development
  builds work without them. Published assets are immutable to workflow retries.
- Keep CI tests headless. In the container, `just run` connects to or starts `just desktop`
  automatically and serves noVNC. `.devcontainer/desktop/run.sh` keeps host viewer opening
  separate from container Chromium for OAuth. Background runs set `STUDY_OPEN_BROWSER=0`.
- **Auth comes from the host;** nothing is logged in inside it:
  - bind mounts of `~/.claude`, `~/.claude.json`, `~/.codex` and `~/.config/gh`;
  - the host's gh token, which `initializeCommand` exports to
    `~/.config/study-devcontainer/gh-token`, because the host keeps it in its keyring;
  - `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN`, when set on the host. API keys are not
    forwarded by default: Claude uses the subscription, which `just agents-doctor` verifies.

  Changes to `~/.claude` inside the container change the host's too, so keep paths there
  `$HOME`-relative.
- Commit `Cargo.lock` and run CI with `--locked` so builds are reproducible.
- Keep `rust-toolchain.toml` and the components the Dockerfile installs aligned.
- Update `README.md` when build or run steps change.

- **Keep one project-wide team**, as `.agents/team/team.md` and `fleet.toml` describe: no
  per-crate squads or status-triggered model prompts. `just check-shell` lints the
  devcontainer shell helpers.
- **One shared skill set.** `.claude/skills` links to `.agents/skills`; `CLAUDE.md` imports
  `AGENTS.md`. Keep instructions portable. Project plugins are Impeccable, Rust LSP and
  Context7, Cozempic and Caveman (full mode); overlapping frontend and multi-review
  plugins are disabled for this project.
