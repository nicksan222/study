# Typed agent tasks and orchestration

- Status: Accepted
- Date: 2026-11-16

## Decision

### Scope and ownership

This record defines the target behavior of Study's in-app agents. It does not
govern development-agent teams or assert that every requirement is implemented.

Native Effect v4 AI owns model calls, schema codecs, streaming, prompts, and
typed tool handling. The shared runner bounds model/tool rounds. Official Effect Workflow and Activity own durable orchestration, including
multi-agent execution, persisted results, waits, interruption, and recovery, under
[Durable background work](durable-background-work.md). Feature services own task
meaning, authorization, acceptance criteria, and domain publication. Model loops do not introduce another durable execution engine.

Developers define agents, tools, procedures, and workflows in TypeScript under
`apps/server/src/features`. The app inspects their execution; it does not provide
an editor for executable agent definitions or procedures.
The shared AI platform runs those declarations with native Effect AI and supplies execution,
context preparation, resource limits, and observability. Models run through the
shared provider boundary on the user's ChatGPT plan. A model capability is usable
only when the installed Effect version and selected provider support its required semantics;
unsupported paths fail explicitly rather than silently changing providers or
introducing a paid API dependency.

### Passing work to an agent

An agent definition is reusable behavior: a stable identity, input and output
schemas, task instructions, model policy, permitted tools, and execution limits.
An invocation supplies the particular task and trusted execution scope. Reuse the
existing agent and tool declaration boundary rather than inventing a second
registry or a generic prompt-only task protocol.

The task contract makes the following explicit, using feature-owned schemas and
canonical contract types where they cross public boundaries:

- The requested outcome, relevant user preferences, and output language.
- The exact inputs and source versions, the selected scope, and evidence policy.
- The required result shape and feature-specific acceptance criteria.
- The authorized resources and actions, and any prerequisite user decision.
- The applicable step, context, output, time, retry, and delegation budgets.

The server binds authority, resource identities, and limits. Model-generated task
text cannot grant permissions, choose arbitrary services, or enlarge the scope.
User requests express goals within this authority; retrieved text, uploaded
content, and child results remain untrusted data. Keep these distinct when
assembling model messages. State missing information or capability explicitly;
ask for clarification only when the missing decision prevents correct execution.

Pass only context needed for the task. Large source inputs use the shared
[bounded context-preparation capability](bounded-document-processing-for-agents.md),
preserving captured versions, anchors, coverage, and original evidence. A summary
is derived context, never a substitute identity for its source. Persisted memory,
when a feature needs it, has explicit scope, provenance, retention, and deletion
ownership; agents do not acquire unrestricted shared memory.

### Tools are scoped capabilities

Tools expose typed domain operations through owning public feature services.
Each declaration supplies validated input and output, a useful description of
when to call it, prerequisites and limits, and whether it mutates state. The
runtime exposes only capabilities permitted for that invocation. A tool name,
prompt instruction, or mutation flag alone is not an authorization check.

The owning service revalidates scope, current authority, and version preconditions
at execution and publication. Models do not receive raw database access,
credentials, unrestricted filesystem access, arbitrary service dispatch, or
ambient cross-notebook authority. Provider-executed tools must be explicitly
declared and subject to the same capability policy.

Mutations require authorization for the concrete operation. An explicit request
can authorize an edit within its scope; do not require confirmation for every
tool call. When a further user decision is required, expose a typed pending
action describing the affected resource and proposed effect. Durable work waits
through official execution infrastructure, then revalidates authority and versions
before proceeding. Approval does not authorize a changed action or stale target.

Report confirmed outcomes from tool results. A requested tool call is not proof
that it executed, and successful generation is not proof that content was saved.
Failures retain canonical `StudyError` and `ErrorKind` semantics across adapters.

### Workflows compose agents; delegation stays bounded

Use explicit feature-owned control flow when the required sequence, branch,
parallel work, or validation rule is known. Reserve model-directed choices for
decisions that benefit from model judgment within that flow. A simple typed
generation does not need a planner, supervisor, or review agent.

Reusable workflow steps are typed feature operations composed with official
Workflow and Activity APIs. Common execution mechanics belong in the platform;
task-specific planning, reduction, review, and acceptance remain with the feature.
Reusable instructions may be shared as task-focused modules, but prose does not
replace schemas, authorization, resource bounds, or durable control flow.

`defineProcedure` declares canonical input and output schemas and a semantic
purpose; `runProcedure` supplies a stable call-site key and executes a native
Activity receipt. Ordinary Effect code composes stages and bounded branches.
Compositions disable outer retries when leaf stages own retry policy.
`procedureTool` exposes a procedure through an explicitly declared agent tool;
it does not grant additional authority. Native receipts remain the only
checkpoint store. Invocation scopes distinguish repeated agent calls even when
their providers reuse tool-call identifiers.

Developer call-site keys, scoped agent ordinals, and tool-name/ordinal keys form
durable invocation identity; provider response identifiers are presentation links.
A native input-signature receipt rejects a changed task at an existing call site
instead of returning an unrelated cached result. An interrupted model loop may
repeat model requests; completed child receipts are reused for unchanged tasks.
Tool handlers execute as native Effects so child retry/configuration waits retain
Effect's recovery semantics.

The provider admission gate covers each model round and releases before tool
execution. Tools and child agents use the same scoped Effect runtime; a child
acquires ordinary admission for its own model rounds. This supports a concurrency
setting of one without permit borrowing or replacement pools, while preserving
the shared provider bound and cancellation ownership. Independent procedure
branches also use ordinary admission.

The shared runner automatically records parent/child links, attempts, terminal
outcomes, bounded typed input/output previews, tool calls, and actual model usage
in the existing workflow progress projection. Model-facing inputs that copy
historical exercise bodies disable input recording; the surrounding procedure
records version references instead. Trace retention follows execution retirement.
The inspector uses localized task purposes instead of internal identifiers,
offers expandable details, and can reopen retained runs from AI activity in
settings. Its recent detail window is bounded and explicitly identified in the UI.

A subagent is a separately scoped invocation exposed to its parent through a
typed delegation capability. The feature permits named child capabilities and
defines which can delegate further. There is no unrestricted recursive spawning
or model-selected executable prompt registry.

The child receives a bounded task brief, necessary context and evidence
references, permitted capabilities, and expected output. It does not implicitly
inherit the parent's entire conversation, secrets, tools, or authority. Effective
child permissions are the intersection of the child's declaration, the parent's
authority, and the delegated scope.

The parent remains responsible for integrating child results and satisfying the
original task. Return a validated artifact or result with evidence references,
coverage, and relevant limitations, rather than only an unstructured transcript.
The parent may receive a bounded summary with references to retained artifacts;
those references must remain resolvable for their defined lifetime. Child output
cannot redefine parent instructions or authorize publication. Private internal
deliberation is not a handoff artifact or user-facing progress record.

Bound total fanout, nesting depth, concurrency, model steps, context, output,
elapsed work, and retry or revision attempts across the entire task tree. Child
calls consume the parent's remaining allowance rather than each receiving an
independent full budget. Bound reservation and accounting before dispatch; after
provider work, record actual usage even if publication fails or is cancelled.
Exhaustion has an explicit typed outcome rather than appearing as completion.
Independent work may run concurrently; dependencies and conflicting mutations
require explicit ordering. Evaluation or repair loops have acceptance criteria,
an attempt limit, and a defined exhaustion outcome.

### Durable execution and completion

Durability follows task ownership lifetime. Request-scoped agents end with their
request scope. Work that must survive that scope is admitted through the owning
feature's durable workflow. Child work is owned by the parent task unless the
feature explicitly admits a separately owned operation.

Persist durable delegation decisions, captured inputs, stable invocation
identities, and required intermediate results through official Workflow and
Activity boundaries. Replaying a completed decision must not choose a new child
plan or repeat completed children merely because a later step failed. Persisted
protocol identities and schemas stay stable within an execution definition;
application updates may invalidate pending work and require explicit user retry.
A multi-step model loop inside one Activity is only durable at that Activity boundary;
it does not establish per-tool or per-child recovery. Side-effecting tools need
explicit replay-safe domain semantics and appropriate durable boundaries.

Cancellation propagates to owned children and provider signals and fences later
publication. Shutdown, deletion, supersession, unknown provider outcomes, and
retries follow the existing durable-work contract. Remote execution is not
exactly once, and local cancellation does not prove remote processing stopped.

Completion requires schema validation and feature-owned semantic checks,
including provenance, scope, and requested output constraints. Model self-review
or another agent's approval is useful feedback, not an authorization or
correctness guarantee. Final writes go through owning feature services and their
transactional publication guards. Concurrent changes produce an explicit
conflict or supersession outcome rather than an unnoticed overwrite.

Expose meaningful task and child progress, pending user actions, terminal
outcomes, and usage through the existing progress contracts. Durable snapshots
remain authoritative after reconnect; transient model deltas are optional.
User-visible progress and failures use English and Italian localization.
Correlate task, invocation, tool, and child identities without logging credentials
or treating full prompts, source bodies, or private deliberation as diagnostics.

## Rationale

Typed task briefs make intent, context, and expected results reusable without
making authority depend on prompt wording. Scoped tools keep domain invariants
in the services that own them. Bounded delegation adds specialist context and
parallelism while retaining one accountable parent and predictable resource use.

Effect AI supplies the model-facing building blocks: `LanguageModel`, `Prompt`,
`Tool`, `Toolkit`, native structured-output codecs, and official provider clients.
Effect Workflow supplies durable execution semantics. One Effect runtime carries
cancellation, scoped dependencies, tracing, and typed errors through both layers,
without Promise callback bridges or a second recovery engine.

Each provider round owns admission capacity only until its stream finishes. Tools
and child agents run after that capacity is released. Native provider clients own
wire protocols; small provider adapters preserve ChatGPT-plan authentication and
structured streaming where the pinned Effect release lacks a public streaming
object API. Google uses a native Effect adapter until an official Effect v4
provider is available. Feature publication remains guarded by its owning service.

## Accepted tradeoffs

- Explicit contracts and scoped capabilities require more definition work than
  sending a prompt to an unrestricted agent.
- Delegation adds latency, context preparation, usage, and integration risk; use
  it where the task benefits, rather than making every task multi-agent.
- Captured context can become stale. Version checks and publication fences can
  reject otherwise useful generated work.
- Durable boundaries require deliberate placement. Unknown external attempts may
  be repeated, incur usage, and return different content on recovery.
- Bounds can stop useful work, and model results remain probabilistic. Typed
  validation and deterministic workflow checks do not establish learning quality;
  prompt and tool changes also need representative live quality evaluation under
  the repository's model-evaluation rules.
