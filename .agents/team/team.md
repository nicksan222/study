# Study's working team

Read `AGENTS.md` for architecture, commands and the crate map. Work inside the devcontainer
and keep Cargo output in `target/devcontainer`. Read the skills your role file requires
for the assigned work. Graphify maps local code relationships; verify its leads in source.

One team works across the project: lead, developer, PM, QA, student, reviewer and pushback.
The lead coordinates; the developer primarily implements; the other roles contribute
on assigned questions. Crates are architecture boundaries, not separate workspaces or
teams. The seven regular roles share one extra slot for scenario preparation, upgrade
review or PR delivery. Do not create nested agents, per-crate teams, or duplicate sessions for the same task.

Each role has a different lens. Availability does not require every role to inspect every
change: the lead assigns only useful work, and unassigned agents stay idle. Product and
pushback input can shape a proposal; code review, QA and student feedback assess different
aspects of the result. There is no required seven-step approval chain.

## Work and communication

- Own a concrete outcome. Read the relevant code and callers, make the smallest sound
  change, and verify it. Avoid unrelated cleanup, new abstractions without uses, or docs
  that duplicate the code. Never weaken a check to make it pass.
- Only the lead talks to the user. The lead owns git operations until explicitly handing
  delivery to the PR maker, within the user's authorization. Only one owns git at a time.
  Other agents stay idle until assigned, then send one concise result to the lead.
  Write the result (including your role, findings, file/line and test evidence) to a
  new file in the `Reports:` directory your brief names, as `<role>-<topic>.md`, using a
  file-edit tool or a quoted heredoc; never write the lead's `task.md`.
  Set `session` to the session from your brief and `report` to that file's path;
  send it with `herdr --session "$session" agent prompt lead "$(cat -- "$report")"`.
  File contents are passed as one argument without being reparsed as shell code. Never
  paste arbitrary result text directly into a shell command: backticks and `$()` execute.
- Assign work by task and files, never by crate alone. One writer per file. State the
  question, permitted files, required evidence, and stopping point in each assignment.
- Everyone shares one checkout, one `target/devcontainer` and one desktop. Every save
  leaves the crate building warning-free; write a function and its caller in one edit.
  Never revert, stash, reset or check out files you do not own, and never mutate the
  checkout to prove a test can fail: use a copy. Before blaming another crate for errors
  naming APIs that exist, check its `git diff`; stale cargo fingerprints cause these.
  `just desktop`, `just desktop-stop` and `just reset-data` affect everyone: the lead
  grants the desktop to one agent at a time.
- One agent owns running checks. Workers run focused tests when assigned; the lead runs
  `just check` once the combined change is ready. Do not repeat a passed check unless new
  changes or evidence warrant it. Share log paths and short results, not full output.
- The code reviewer checks correctness, contracts and missing tests in one pass.
  The upgrade reviewer, started on demand, asks only whether the change breaks an
  existing user's data or a contributor's setup on upgrade.
  QA verifies behavior; the student evaluates usability; pushback challenges assumptions.
  Share evidence between roles instead of repeating the same checks.
  Re-review only affected findings after fixes. No chain of overlapping approvals.
- Herdr's sidebar shows status. Do not poll on a loop, broadcast status, send messages for
  every transition, or wake another model merely to ask whether it is done. Send a blocker
  once with the specific decision needed; after three failed attempts, report evidence.
  Idle is not done: when work is in flight and nothing has reported for about ten
  minutes, the lead checks `herdr agent list` once, reads a stalled pane and re-briefs it.
- Models and effort per role come from `.agents/team/fleet.toml`: the strongest for the
  lead's integration decisions and the review, a faster one for the rest. Give routine planning to PM and
  bounded implementation to the developer; reserve the lead for consequential decisions.
  Escalate a specific difficult question to the lead, not the entire task to more agents.
- Before pausing or handing off, the lead updates the indicated gitignored `task.md` with
  the objective, decisions, current step, owned files, verification and next action. Keep
  it under 60 lines; it is a checkpoint, not a second design document. A restarted agent
  reads it and checks the current diff before doing work.
- `just agents-usage` reads local token records without model calls. It does not know the
  remaining subscription allowance; `/usage` in Claude Code is the authority for that.

## From a request to a pull request

The lead takes a request through implementation, appropriate review and QA, `just check`,
then hands the verified result to `pr-maker`. This is a task-completion handoff, not a
file watcher: do not wake an agent on every edit. For an implementation request, delivery
normally means a pull request; an explicit request to keep changes local or unstaged wins.
The default team still has seven roles. Stop the scenario agent after its handoff before
starting the PR maker; they share the eighth slot.

Before work, the lead records the starting branch and existing changes in the task
checkpoint. Resolve the GitHub remote and target branch from repository configuration;
ask for a destination if none exists. Never invent a repository or include unrelated edits.
At handoff, give the PR maker the objective, acceptance criteria, owned paths, base/head
branches, final commit or diff identity, check results/log paths, review findings and QA
capture paths. Pause other writers while it prepares the branch and pull request.

Start the role only when needed (use the session name from your brief):

```sh
just agents pr-maker --session "$session" --no-attach
```

Then send the handoff file using the same `agent prompt` pattern above, addressed to
`pr-maker` instead of `lead`. It reports back once with the PR URL, demo decision and any
remaining blocker. The lead delivers that result to the user. There is no automatic merge.

## Scenario preparation and current evidence

QA, student and PR maker request missing test/demo states through the lead. The lead
starts `scenario` only for a concrete request: desired state or behavior, acceptance
criteria, relevant code, and who will use it. Start it with
`just agents scenario --session "$session" --no-attach`, then send the task through
`agent prompt scenario` using the report-file pattern above. Stop `pr-maker` first if it
occupies the shared optional slot; save its handoff before stopping it. Never evict a
working role automatically. After preparation, stop `scenario` and give its handoff to
the consumer. It is a seeding specialist, not another QA or implementation team.

Every role treats old messages and checkpoints as pointers to evidence, not current facts.
Before reusing a scenario, check its code revision, relevant uncommitted diff, fixture
inputs, database path and actual state. Recheck when any of these changes. Record missing
information as unknown; never invent a model response and report it as observed behavior.
Keep task-specific sample content and assumptions out of permanent agent memory. Store
reproducible setup and limitations in the session handoff, and do not load old scenarios
merely because their files survived a reset. Durable fixtures belong in code and tests.
