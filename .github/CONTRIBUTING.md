# Contributing

Thank you for helping with Study.

## The rules

- **Read [AGENTS.md](../AGENTS.md) first.** Its golden rules, crate map and commands apply to
  people as much as to agents. Everything else is in the code, beginning with each crate's
  `src/lib.rs`.
- **One branch per change.** Open a pull request to `main`; nothing goes to `main` directly.
- **Record agreed architecture requirements in `doc/adr`.** Follow
  [Architecture decision records](../doc/adr/architecture-decision-records.md).
- Dependabot pull requests targeting `main` use squash auto-merge after the required
  `Test and build` check passes on the current base.
- **Run `bun run check` before you push.** Turbo owns the verification graph for local
  checks and CI: Rust formatting/Clippy/dependencies/tests/doctests/docs, repository-wide
  Vite+ format/lint, Fallow, TypeScript checks, package tests, web build and browser E2E,
  generated database drift, real integrations, the packaged-runtime smoke test, and landing
  checks/build. Docker is required for real integrations. CI starts eight unconditional
  lanes in parallel: 🧹 Code hygiene, 🧩 Types & unit tests, ⚙️ Server & contracts,
  🗄️ Database, 🌐 Browser journeys, 🦀 Desktop & runtime, 🔌 Provider integrations and
  🌍 Landing page. Each lane selects tasks from the same Turbo graph. Static checks and
  landing builds no longer wait for native toolchain setup; browser journeys have their
  own three-shard matrix and canonical devcontainer. Each shard uses two workers;
  independent cases, including settings pages in one file, can run in parallel. The
  required `Test and build` check fails if any lane fails, is cancelled, is skipped or is missing. Independent tasks continue after
  failures; dependent tasks run only when their prerequisites pass. The client build
  reuses its prerequisite typecheck and can overlap independent unit and tooling tests.
- **CI runs the complete server suite once without sharding**, retaining two Vitest workers.
  Server fixtures use `/dev/shm` for RAM-backed
  temporary files on Linux CI, retaining WAL, locks, backup and restart behavior. Local
  tests use the normal temporary directory; each test still owns its database.
- **Every visible word comes from `@study/localization`, in English and Italian.** If you
  can't write the Italian, say so in the pull request.
- **Report a vulnerability privately**, as [SECURITY.md](SECURITY.md) says, never in an
  issue.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

CI dependency installation sets `ONNXRUNTIME_NODE_INSTALL=skip` to avoid optional CUDA
downloads. The package’s bundled CPU runtime remains available for the checks.

## Set up

### In the devcontainer

The devcontainer (`.devcontainer/`) installs every tool. Its Dockerfile-specific ignore
file admits only tool setup inputs; dependencies and build outputs stay outside the image
build context. The Devcontainer workflow verifies the allowlist against Docker’s real
ignore matcher with `bash tooling/scripts/devcontainer/test-build-context.sh`. Open the folder in VS Code and
reopen it in the container, or use the devcontainer CLI:

```sh
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . bash
```

`bun run landing-check` checks website types and builds every localized static preview, so
preview rendering failures are caught by pull-request CI before deployment.

The devcontainer installs root and landing dependencies from their committed locks. To
refresh them, run `bun install --frozen-lockfile` and `bun install --cwd apps/landing --frozen-lockfile`, then
run `bun run check`. The former Rust
server and browser bridge have been retired; the replacement server does not yet provide
all application features. Browser screenshots use the devcontainer's lockfile-pinned Playwright Chromium; setup installs it before tests. The system Chromium remains for desktop tools.

### Native Linux setup

On Debian or Ubuntu, install [mise](https://mise.jdx.dev/getting-started.html) and run
these commands from the repository root:

```sh
mise trust
mise run setup
mise exec -- bun run check
```

Setup uses sudo for system packages, then installs the project toolchain, both locked
dependency sets, and the pinned Playwright Chromium. Start Docker separately for the
provider integration suite. For Linux release packaging, use
`PATCHELF="$PWD/target/mise/bin/patchelf"`. The devcontainer installs the same dependencies during
its image build and workspace setup.

The first build takes a while. Use `cargo clean` when you explicitly want to remove native build artifacts;
development commands do not prune the Cargo cache automatically. Direct Cargo commands,
editors and package scripts all default to `target/devcontainer`, including `cargo clean`. Desktop IPC tests use `swaymsg` from the `sway` package.
The Devcontainer workflow can also be run manually in GitHub Actions to build and start the
image independently of its path filters.

### Everyday commands

Use the local web app in a browser for routine development and UI verification. First
check `http://localhost:5173` and reuse it if Study is already working. Only otherwise
run `bun dev` from the repository root inside the devcontainer to start the web app and
Effect RPC server. Vite updates frontend modules; Bun watch restarts the backend when
its imported source changes. The native Vite config loader avoids temporary bundled-config
restart loops. Development data lives in `target/web/study.sqlite`; set
`STUDY_DATABASE` to use another database.

The devcontainer forwards web port 5173 without opening a browser. Native desktop and
noVNC packages stay installed but do not start automatically. Reserve `bun run run` or
`bun run desktop` for Tauri-specific checks; neither starts noVNC. To explicitly use the
remote native viewer, run `bun run desktop-attach` and manually forward container port 5900.
Routine browser work needs none of these native helpers.

The root package scripts expose the project commands; `bun run` lists all tasks. Client Vite, router and TypeScript
configs live in `apps/client`; shared TypeScript settings live in `tooling/typescript`.
Rust lint and dependency policy live in `tooling/rust`; `.cargo/config.toml` points Clippy
there for both recipes and direct Cargo invocations. Root package scripts select the shared client
workspace and server TypeScript config. Vite+ (`vp`) owns web development, builds,
Vitest for unit, server and tooling tests, formatting (Oxfmt), and linting (Oxlint).
Playwright Test runs browser journeys under Bun. Root `vite.config.ts` imports the
shared policies from `tooling/oxc-config`; these apply to server, frontend, tests and tooling.
Run `bun run format` to format, `bun run format:check` to check formatting, and `bun run lint`
for the combined format/lint gate with warnings denied.
The Vite+ pipeline uses syntax-only lint analysis, React stability rules and package-manifest
sorting; dedicated TypeScript checks and Study's architecture rules remain required. Database test fixtures lazily copy an empty database migrated once per test module, then
open it through the regular `Db.open` path. Each test still owns a private file with WAL,
foreign keys and recursive triggers; custom migration folders always run their own migrations.
Server tests use the Bun
runtime (`bun run server:test`) with one result per test. Passing server test files hide
stdout, stderr and fixture diagnostics; a failing file prints its captured output alongside
assertion details. Console events are file-scoped, so diagnostics include the whole failing
file. Fixture phases still identify setup, body operations and cleanup. The inherited test
timeout is three minutes; the crash-recovery lifecycle test has a one-minute timeout, and
automatic resource/database cleanup hooks have a thirty-second timeout. These bounds fail
tests; they do not cancel arbitrary promises or guarantee a blocked event loop can recover.
The CI server test step fails after ten minutes; frontend tests keep the verbose Vitest
reporter and show console output only for failing tests. TypeScript checks keep `tsc`.
Run `bun run fallow:check` or `bun run fallow-check` for the pinned Fallow quality gate.
It checks the full repository for dead code, code health and duplication and fails on
any reported issue. Local `bun run check` and the required CI `Test and build` job both
run it; there is no baseline or new-issues-only mode. `tooling/fallow.jsonc` enforces maximum
cyclomatic complexity of 10 and cognitive complexity of 15. Functions longer than
60 lines are reported as advisory refactoring targets. CRAP enforcement is disabled
until measured coverage is configured. Clone detection starts
at 50 tokens and 5 lines, and every detected clone fails the gate. The config documents one content-sensitive
exception for an independent feature-owned SQL join; changing its content or copy count
requires review again. These checks
supplement the existing architecture lint and TypeScript checks.

Run `bun gen` from the workspace root to generate database migrations and desktop routes.
Run `bun gen:check` to check generated database outputs
without changing the database schema. The equivalent package scripts are `bun run gen` and
`bun run gen-check`.
Desktop inspection recipes call `swaymsg` and `jq` directly. The scripts in
`tooling/scripts/desktop/` manage the virtual desktop; `lifecycle.py` owns private D-Bus
startup, reuse and shutdown, plus bounded process waiting. Desktop commands need no
JavaScript package or Cargo build.

| Command                         | What it does                                               |
| ------------------------------- | ---------------------------------------------------------- |
| `bun run desktop-status`        | Inspect the native window and log path without restarting. |
| `bun run desktop-wait`          | Wait for the native window.                                |
| `bun run check`                 | Everything CI runs.                                        |
| `bun run check-crate <package>` | `bun run check` for one package.                           |
| `bun run`                       | Every other command.                                       |

## Where data lives

- `~/.local/share/study/`: the database (`study.sqlite3`) and `diagnostics.log`.
- Existing local-model caches may remain from earlier releases; the retired server no
  longer installs or uses them.

Existing data is retained. Native development selects `target/dev-data`; no reset or seed
command is provided during the server transition.

## Captures of the app

The README demo and website stills and clips are committed from an earlier release.
The former capture runner was retired with the Rust server.

## The agent team

The devcontainer mounts your AI logins and ships an optional team of agents for
maintainers: lead, developer, PM, QA, student, reviewer and pushback.

| Command                                     | What it does                                                 |
| ------------------------------------------- | ------------------------------------------------------------ |
| `bun run agents-doctor`                     | Check tools and subscription login, without a model request. |
| `bun run agents`                            | Open the team, keeping existing conversations.               |
| `bun run agents lead developer --no-attach` | Start only some roles.                                       |
| `bun run agents-reset`                      | Start fresh conversations and clear the task checkpoint.     |
| `bun run agents-stop`                       | Stop the team.                                               |
| `bun run agents-usage --hours 24`           | Local token counts, not remaining allowance.                 |

Give the lead the task. It splits the change into small slices, each built and reviewed on
its own; QA and `bun run check` run once on the result. On demand it starts `scenario` (seeded
test states), `upgrade-reviewer` (does an existing install still work?) and `pr-maker`
(commits, pushes and opens the pull request, never merges), and `site` keeps the website in
`apps/landing/` in step with the app, in English and Italian. These four share one slot.

Models and roles live in `.agents/team/fleet.toml`, the working agreement in
`.agents/team/team.md`, and each role's checklist in `.agents/team/roles/`. The handoff is
kept in `target/agents/<session>/task.md`. Publishing needs an HTTPS GitHub remote and a
login with push access; host credentials are forwarded at container start, never baked into
the image.

## Releases

Every push to `main` releases after the required `Test and build` CI job passes. PRs and
manual CI runs do not publish. The version is the numeric Tauri base plus the CI run
number in its patch component: base `0.1.1`, run 42 becomes `0.1.43`. This version is
embedded through the effective Tauri config without a version-bump commit. The workflow
creates `v0.1.43` on the exact checked commit. Failed runs keep their version on retry.
Keep workspace and base Tauri versions aligned when changing the release series.

The release builds Tauri packages on Linux x64/ARM64, macOS Apple
Silicon and Windows x64. Each build retains its signed bundles as an isolated Actions
artifact. `tooling/scripts/release/release.sh` then verifies every updater with Minisign, checks
all four platform/version/file digests, preserves the website's stable download names,
and writes `latest.json` once. A single publisher uploads the complete set and clears the
draft only after that validation. Published releases are immutable to retries.
After successful publication, main CI keeps five published releases: the current Latest
updater target and the four most recently published others. Older releases and their
assets are deleted; drafts and Git tags are preserved.

Generate a signing key using `bun --bun tauri signer generate -w /secure/location/study.key`.
Keep a secure backup; never commit it. Set the repository variable `STUDY_UPDATE_PUBLIC_KEY`
to the base64 encoded public key printed by Tauri (not raw Minisign text), secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the private key/password, and allow Actions to
write release contents. The release preflight merges that same public key and endpoint into
Tauri's effective bundler configuration; the app reads the embedded configuration.
The release helper returns an absolute native configuration path on every platform so
Tauri can resolve it after changing to the desktop package directory.
The existing `CARGO_PACKAGER_SIGN_PRIVATE_KEY` and its password are accepted as a pair
when no Tauri-named key is configured: both signers use the same base64 Minisign format.
This preserves the installed public key without rotating credentials. A Tauri-named key
takes precedence with its own password (including an empty password). Preserve the key
pair across releases. GitHub selects Latest using its semantic-version policy so a slower older build does not become the update.

Signed desktop builds check at startup and hourly, and offer a persistent notification
with an **Install and restart** action. Downloads require that action; Tauri verifies
the signature before installing. Failures offer retry. The private server shuts down
before restart (and before the Windows installer exits). Browser, debug and unsigned
builds skip the updater. Linux in-app updates require the AppImage distribution.
Tauri’s pre-build hook stages Bun, the private server’s source, locked production
dependencies, the macOS SQLite library and Drizzle migrations under `target/desktop-runtime`. The same resources
ship in both installers and updates. Every platform smoke-tests Tauri’s copied runtime
from `target/devcontainer/<target>/release` in an isolated directory with a fresh database,
then restarts against that database without depending on a system Bun installation.
On macOS, even read-only startup validation selects the bundled SQLite library before
opening a connection. Release size reports use the same Cargo output directory. Run
`bun run desktop:runtime` to stage it independently. macOS development also requires
`brew install sqlite`, since Bun’s system SQLite cannot load the vector extension.
Linux CI and the devcontainer use the pinned Patchelf 0.19.3 from
`tooling/scripts/devcontainer/install-patchelf.sh`; older ELF rewriters corrupt Bun’s ARM64 symbol-version pointers.

For local bundles without signing credentials, use `bun run package linux-x86_64 --unsigned`.
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

`bun run package linux-x86_64` (or `linux-aarch64`, `macos-aarch64`, `windows-x86_64`) invokes
Tauri on a matching native runner; signed builds require the same updater key environment as CI. Output lives beneath the Cargo target directory's
platform `release/bundle` directory. CI uses the same Tauri config at
`apps/desktop/src-tauri/tauri.conf.json`, with no cargo-packager dependency.

## License

Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in Study, as defined in the Apache-2.0 license, is dual licensed under
[Apache 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), without any additional terms or
conditions.

The TypeScript server uses Drizzle with schema modules in `packages/db/src/schema`.
Run `bun gen` after changing the schema and `bun gen:check` to check drift.
`apps/server` owns the tRPC router and inferred client contract; it needs no code generation.
Desktop, CLI, and web clients use the same typed procedures.

`@study/db` exports `Db` and the schema; it contains no business rules. Procedures live in
`apps/server`, grouped by domain with input validation and a sibling `.test.ts` for each
operation. Tests use fresh SQLite databases and actual services. `apps/server/src/runtime/main.ts`
starts and stops the server process. The app is local only; ChatGPT provider sign-in is retained.

Tests import `test` from `@study/testing` and request native assertions as callback
fixtures. Real server cases register with `test.server.stable`; pure logic uses
`test.unit.stable`. `node:assert` imports are forbidden. `bun run server:test`
runs the server and package suites; `bun run quality:test` runs lint, development,
desktop permission, and shared runner tests. Server fixtures use Vitest lifecycle
hooks to close resources before deleting SQLite files. Test-runner imports stay out
of production modules.

Run `bun run integrations:e2e` with Docker available to run the real provider tests.
The launcher prepares one shared disposable environment and invokes Vitest once.
Ordinary `*.integration.test.ts` files under `tooling/testing/integrations/providers`
report the behavior being checked, with native assertion failures, exit codes and JUnit
results. Every provider's tests are discovered on every run; no matrix or shard is used.

Each test owns fresh application processes, profiles, vaults, a database and RPC server.
Provider software and its pinned install remain in the shared
`tooling/testing/integrations/Dockerfile`. Release downloads use bounded retries and
verify checksums. The test environment has no network and mounts no host vault,
credentials, dependencies or profile.

The Bun launcher uses the Docker CLI directly. It collects native JUnit reports and
failure logs, stops and removes the container and removes its image on success, failure
and handled interruption. Setup output stays in
`tooling/test-results/integrations/setup.log`; normal console output shows the tests.
Provider logs are retained for failed tests. CI uploads `tooling/test-results/`,
including `vitest/integrations.xml`. The launcher preserves the test exit code and fails
if environment setup, report collection or cleanup fails.

Adding a provider requires its executable in `providers.json`, ordinary
`providers/<provider>/*.integration.test.ts` files and a matching installation stage in
the shared image. Oxlint enforces the shared installation and test coverage. Keep
infrastructure lifecycle tests in the normal server suite, separate from provider behavior.

### Release size reports

Each release build retains a `size-report-<platform>` Actions artifact for 90 days.
It lists logical file bytes for the staged runtime and built application, runtime
components, packages and largest files, plus installer and updater file bytes.
Symlinks are excluded and never followed. The application is the macOS `.app`
bundle or the Linux/Windows executable, so it is not a complete installed-size
measurement on Linux or Windows; do not add it to the runtime total on macOS,
where the app already contains the runtime. Archive bytes are download sizes,
not installed sizes. Compare builds on the same platform with the same toolchain,
locks and settings.

For a local report, run:

```sh
python3 tooling/scripts/release/size_report.py --runtime target/desktop-runtime --app PATH --artifact INSTALLER --artifact UPDATER
```

(after staging the runtime and building the application). Repeat `--artifact`
for each download; identical paths are counted once. Redirect output outside the
checkout when keeping a baseline.

The server suite runs a Bun-hosted server against a disposable database, kills it after a durable request is committed, and verifies recovery after restart. This test uses real loopback networking and runs with the other server tests in `bun run server-check`.

### Browser journeys and visual references

`bun run web:e2e` builds the real frontend once, then runs Playwright Test under Bun
with fresh real SQLite/RPC state. `bun run web:e2e:compare` uses the same Turbo task
and reuses a matching build from its cache. Use native runner filters, for example
`bun run web:e2e:compare --grep "Notes preserve multiple edits after reopening"`.
Playwright owns browsers, isolated contexts, worker scheduling, test timeouts, traces,
failure screenshots and the HTML report. Application fixtures own the real database,
RPC server and Vite preview through standard asynchronous disposal.

Journeys import `test` from `@study/testing`. Define a journey directly:
`test.browser.stable('Notes preserve edits after reopening', async ({ page, expect,
expectScreenshot }) => { ... })`. The readable title also determines its baseline and
artifact directory. Suite-wide preflight rejects duplicate normalized titles across files,
including punctuation collisions, before any journey runs. Await named screenshots
with explicit readiness assertions, for example:

```ts
await expectScreenshot('projects', {
  target: 'viewport',
  ready: () => expect(page.getByRole('heading')).toBeVisible()
});
```

Oxlint enforces direct journey registration and forbids wrapper registration, request mocking,
fixed sleeps and directly owned resources. Resource lifetime is private to the
harness; contexts, databases and RPC listeners are fresh for every attempt. A journey
with no completed screenshot fails. Every normal run executes the entire suite;
there is no dependency graph, affected selector or route registration.

Run development and checks inside `.devcontainer`, including screenshots. The repository
has one environment definition: Debian Trixie, Bun 1.4.4, explicitly installed font packages,
and Chromium selected by the lockfile-pinned Playwright 1.65.0. `post-create.py` installs
the browser once during setup; tests never download browsers or use system Chromium.
After changing the Playwright lockfile entry, rebuild the devcontainer to provision
the matching browser before running tests. Local development and browser CI use this same configuration. Linux x64 is selected
for consistent references; ARM hosts run the container under emulation.

From the host:

```sh
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . bun run web:e2e
devcontainer exec --workspace-folder . bun run web:e2e:update notes-preserve-multiple-edits-after-reopening
```

Inside the container, use ordinary `bun run web:e2e`, `web:e2e:compare`,
`web:e2e:update` and `web:e2e:capacity` commands. There is no screenshot-specific
container launcher, host rendering profile, runtime image attestation or fallback.
Before launching Chromium, both comparison and update runs reject platforms other than
Linux x64. This guard prevents accidental incompatible captures; use of the canonical
devcontainer and its fonts remains a repository convention, not image attestation.
Contexts use a standard QHD 2560×1440 CSS-pixel viewport at 100% browser zoom and
`deviceScaleFactor: 1`. Study's saved `zoomPercent: 125` is applied through the
normal appearance path as root CSS zoom. Every app screenshot waits for that 125%
zoom before checking journey readiness. Element screenshots retain their
natural bounds within that viewport. The native report attaches capture profile metadata
alongside the observed browser version and workflow identity.

`bun run web:e2e:update notes-preserve-multiple-edits-after-reopening` explicitly generates candidate
references for one workflow; append `/editing` to update only that screenshot.
Updates are forbidden in CI. Inspect candidate PNGs before
accepting them; generation does not approve a design. No Git hook updates or stages
images. Native Playwright screenshot assertions use a 0.2 perceptual color threshold and
allow isolated rendering drift beyond that tolerance up to the stricter of 10 pixels
or 0.01% of the image. Both limits apply: a 100×100 capture permits one differing pixel,
while a 2560×1440 capture permits at most ten. This is a noise budget, not permission
to accept changed content or layout. Dimension changes always fail.
Missing references and differences beyond the budget fail ordinary comparison without
rewriting references (`updateSnapshots: none`). Playwright owns stabilization, comparison
and expected/actual/diff attachments; Study retains application readiness, focus normalization
and explicitly scoped updates. Native runner outputs live under `apps/client/test-results/playwright`, and
its HTML report lives under `apps/client/test-results/report`. Playwright clears its previous
run outputs at the start of the next run and retains test artifacts only for failures.
CI also enables Vitest's built-in JUnit reporter. Every package writes under its own
`test-results/vitest/` directory; integration runs use `integrations.xml` alongside unit
`junit.xml`. CI retains reports for JavaScript, server, database and integration jobs even on failures.
Turbo caches restore report files with deterministic test results. Use `CI=true` for the
same reporters locally; ordinary local runs keep console output only.

Selected Projects, Settings, composer and bilingual note-edit checkpoints also run
`@axe-core/playwright` WCAG 2.1 A/AA scans through `expectAccessibility(name)`.
Violations fail the journey and the native report includes the complete axe JSON result.
Keep keyboard and focus assertions alongside these automated scans.
Set `E2E_REVIEW=1` to retain successful traces and capture artifacts for the current run too.
Open the report with `bun --bun playwright show-report apps/client/test-results/report`,
or a trace with `bun --bun playwright show-trace PATH`. Unit-level contract fixtures use
temporary directories removed by their test finalizers.

`bun run web:e2e:capacity 3 2` builds as needed, then measures three complete comparison
runs with two workers and writes timings under `test-results/`. Counts represent
repeated pilot invocations, not additional workflow coverage. Increase the first
argument up to 100 for longer measurements; supported worker counts are 1, 2 and 4.

## Package verification with Turbo

Use `bun run check:changed` for affected packages and their consumers, or append `--dry`
to inspect the plan without running checks. Turbo includes uncommitted and untracked
files. Set `TURBO_SCM_BASE=origin/main` (or another ref) to choose the comparison base;
an unavailable base reports an error. Without an override, Turbo compares with `main`.

`bun run test`, `bun run typecheck`, `bun run build`, and `bun run check` run the respective
tasks across workspaces. Add `--filter=@study/client` to select a package, or use
`bun run test --affected` for affected tests only. Packages own their task commands;
Turbo handles selection, dependency ordering, and local caching. Shared source-only
packages participate in the graph without redundant builds or separate typecheck projects.
The existing server, client and tooling TypeScript projects remain the checking boundaries.

CI group membership is defined in `turbo.json`: `check:hygiene`, `check:javascript`,
`check:server`, `check:database` and `check:native` are aggregate tasks without shell
commands. Their `ci:*` scripts allow two independent tasks at once. The JavaScript lane
owns typechecks, the client build and client/tooling unit tests; server and database
suites have separate jobs and reports. Browser, integration and landing jobs select
`web:e2e:compare`, `integrations:e2e` and `landing-check`, respectively. Browser CI
uses native Playwright `--shard=1/3`, `--shard=2/3` and `--shard=3/3` with case-level
parallelism; the sequential harness cleanup checks stay in one worker. All shards run
even after a sibling fails and upload separately named diagnostics. The required gate
waits for the entire matrix and rejects a failed or cancelled shard. Other lanes run
without sharding. No lane uses a path filter or change detector. Turbo decides which
deterministic task results can be reused; server, database, integration and browser tests still execute every run.
`web:e2e:compare` forwards runner options such as `--workers` and keeps the build
prerequisite. The full check also stages the private server before its packaged-runtime
smoke test. Regression tests compare runnable tasks across local and CI plans, exercise
the required gate with failures/cancellations/skips, and verify that builds can overlap
independent tests.

The shared JavaScript setup caches Bun dependency downloads and Turbo results. Native
checks retain the Cargo cache. Browser CI restores the workspace Turbo cache before
entering the devcontainer, where client builds can reuse it. Artifact uploads retain
per-lane test reports and browser diagnostics even on failure.

Release builds use four explicit parallel jobs for Linux x64, Linux ARM64, macOS ARM64
and Windows x64. They call the same reusable platform workflow without a matrix. The
single publisher waits for every platform, verifies the complete signed artifact set,
and only then publishes the release.

Pure unit tests, typechecks and web builds are cached locally under `.turbo/cache`.
Root task commands evict entries older than seven days and then the oldest entries above
512 MiB after Turbo exits. Persistent Vitest transforms are bounded separately to 128 MiB
and seven days, so edited source revisions cannot accumulate indefinitely. Eviction removes archives and their metadata together; cache
misses simply rerun the task. Architecture checks reject bypassed root entry points,
divergent native output paths and broadened image contexts. Oxlint rejects persistent
module caching in disposable runners and contract fixtures allocated under `test-results/`. Direct `bun --bun turbo` calls bypass this maintenance.
Server/database, real integration, browser-journey, tooling and native tests stay uncached.
Repository-wide static gates also run fresh. Their inputs select shared policy changes for
affected checks; selected package checks still require the complete static gates.
Build output and generated routes are restored on cache hits. Shared configuration and
explicit cross-package inputs invalidate affected task results; task-input-aware selection
is enabled and covered by regression tests. Local full checks keep sequential task execution. CI aggregate tasks run up to two
independent tasks concurrently; Turbo preserves prerequisites for route generation and builds. No remote cache is configured,
and the root commands disable Turbo telemetry.

Affected checks do not establish that the entire repository passes. `bun run check` and the
full CI gates remain required; native launchers and desktop lifecycle commands keep their
existing interface. The standalone landing workspace is checked as an uncached root task.

Tests import one facade and name the execution environment explicitly: `test.unit` for
logic and component tests, `test.server` for real database, services and RPC tests, and
`test.browser` for Playwright journeys. Runner configuration supplies the corresponding
fixture graph; unavailable environments and fixtures are rejected by TypeScript. There
are no flat `test.stable` registrations or root-level hooks.

```tsx
import { test } from '@study/testing';

import { useGeneralSettings } from '#client/pages/settings/general/use-general.ts';

test.unit.stable('renders the saved settings', async ({ react, rpc, expect }) => {
  rpc.given({
    'settings.appSettings': { language: 1, appearance: 3, zoomPercent: 100, onboarded: true }
  });
  const { result } = react.renderHook(useGeneralSettings);
  await react.waitFor(() => expect(result.current.data?.zoomPercent).toBe(100));
});
```

`expect`, `assert` and `expectTypeOf` are callback fixtures exposing the native assertions. Request
`mock` in the callback for spies and module mocks. Register a module mock before dynamically
importing its subject; the fixture owns module-cache isolation and restores mocks on cleanup.
Use canonical workspace aliases or package names for targets. Shared setup can request the
same fixture through `test.unit.beforeEach(async ({ mock }) => { ... })`.

```ts
import { test } from '@study/testing';

test.unit.stable('browser host capabilities are explicit', async ({ mock, expect }) => {
  mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: mock.fn() }));
  const { hostCapabilities } = await import('#client/lib/host.ts');

  expect(hostCapabilities()).toEqual({ updates: false, diagnostics: false });
});
```

`vi` is a callback fixture for native clock and inspection utilities. Browser tests use `test.browser.stable` through the same public
import and receive native Playwright assertions, page, screenshot and accessibility fixtures.
Their `rpc.client` and `rpc.runPromise` support setup and checks against the page’s real server;
the client scope closes before the server is released. The `test` namespace is reserved for registration, classification, suites and hooks; Oxlint rejects runtime helpers and opaque context spreads.

TypeScript narrowing assertions require an explicitly typed local binding: request `{ assert: assertions }` and declare `const assert: test.Assert = assertions;`. Ordinary `expect` assertions need no extra annotation. Test helpers accept the utilities they need through explicit parameters typed with `Pick<test.unit.Context, ...>`.

Fixtures initialize when requested through callback parameters, share their dependencies
within that test, and release consumers before their backing resources. Pure tests open
no database or application. Parameterized cases that need fixtures use native `.for`:

```ts
import { test } from '@study/testing';

test.unit.stable.for(['english', 'italian'] as const)(
  'opens Notes in %s',
  async (locale, { page, expect }) => {
    await page.open('/notes', { locale });
    expect(await page.screen.findByRole('main')).toBeVisible();
  }
);
```

| Fixture       | Prepared resources                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `react`       | Component/hook rendering, memory router context, localization, UI providers and user interaction.  |
| Client `rpc`  | Schema-validated `given`, `handle` and `update`; unplanned calls fail teardown.                    |
| Client `page` | Real app routes with explicit empty-workspace snapshots and owned router histories.                |
| `mock`        | Scoped runtime module mocks and spies, with automatic restoration and isolated subject imports.    |
| `assistant`   | Fresh chat RPC handlers, message fixtures and owned asynchronous page rendering.                   |
| `db`          | One isolated SQLite connection, opened only when requested.                                        |
| `databases`   | An owned factory for tests requiring several independent databases or migration inputs.            |
| `server`      | Real application, store and bound Effect service runtime; workers start explicitly.                |
| Server `rpc`  | Real HTTP endpoint and scoped client, sharing the requested server; `reopen()` preserves its data. |
| Browser `rpc` | Typed client and `runPromise`, connected to the same isolated server used by the browser page.     |

Stable, regression, migration and characterization classifications share the prepared
runner: `test.server.regression({ regression: 'evidence_integrity' })(name, callback)` receives
the same fixtures. Keep catalog metadata literal. For a localized React case, use
`test.unit.stable.extend('locale', 'italian')(name, callback)`.

Request `runTestEffect` for scoped Effect execution and `observeUntil` for observable
state. `pollUntil` is reserved for external engines without subscriptions and needs
an explicit observation budget. Process and temporary-resource helpers register ownership
with the native runner; fixture implementations and standalone scripts retain internal
facets for composing their owners.

Oxlint requires the public namespace in ordinary tests, keeps classifications visible,
rejects direct assertion/helper imports, and prevents manual database/application
construction and local setup wrappers. The narrow fixture-lifecycle tests exercise the
constructors themselves. Domain database tests use their own runner environment so merely
loading a test never configures server workflow schema. Native RPC and browser checks use
real services and isolated data.

Generic mechanisms live in `packages/testing`; database, protocol and application
fixtures stay with their owners. Integration drivers and disposable environment assembly
live in `tooling/testing/integrations`. `testPolicy` remains a pure export for runner
configuration; importing the public package from configuration never loads a test runner.
