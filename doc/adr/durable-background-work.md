# Durable background work

- Status: Accepted
- Date: 2026-11-15

## Decision

### Official execution infrastructure

Study uses official Effect `ClusterWorkflowEngine`, composed with `SingleRunner`
and the official `@effect/sql-sqlite-bun` adapter for SQLite SQL persistence.
Effect and adapter packages are pinned to compatible versions, and upgrades
preserve the composition's persistence and recovery guarantees.
One embedded runner runs in the application server process. In-memory runner
coordination is acceptable; messages and replies must remain SQL-persistent.
No multi-machine cluster, separate worker service, or resident daemon is required.
The runtime must prevent concurrent independent embedded runners against the
same database unless that composition is separately proven and agreed.

Effect Workflow and Activity own execution, activity result persistence, durable
waits, scheduling, interruption, and recovery. Study has no parallel lease,
checkpoint, timer, scheduling, or execution recovery machinery.
Study may compose official layers and supply domain integration; it must not
reimplement the execution machinery when an upstream limitation is discovered.

Feature-owned workflow definitions, typed activities, and public services live
in `apps/server/src/features`. Shared composition lives in `platform` and
`runtime`. Domain glue owns admission, transactional outbox delivery, stable
dispatch identities, publication guards, progress, and resource policy.

### Lifetime and admission

Choose durability by ownership lifetime, not expected duration. A direct operation
belongs to its request scope and is interrupted when that scope ends. An operation
that must outlive its initiating request is admitted as durable work, even if fast.

Persist durable admission before acknowledging acceptance to the caller. A
committed domain intent can be accepted as queued before the runner receives it,
provided the outbox guarantees subsequent delivery. Acceptance is not completion.
A transport failure can still leave admission outcome unknown.

Closing a view or window does not cancel durable work. Fully quitting Study stops
execution; restarting resumes eligible existing workflows from persisted state.
Closing the last window follows the OS and application's exit policy. There is no
hidden resident process after application exit.
Shutdown interrupts local execution without recording explicit user cancellation.
Recovery must distinguish interrupted execution from terminal cancellation.

### Atomic domain intent and durable dispatch

Domain changes and their typed outbox intent commit atomically in the domain
transaction. Notifications are hints; pending committed intents remain
rediscoverable without an event. Use a stable dispatch identity for each intended
workflow so replay after a crash targets the same execution.

Acknowledge outbox delivery only after the official engine has durably accepted
the dispatch. Durable acceptance is established by the pinned API's persistence
contract;
starting a fiber or returning from an enqueue call alone does not establish it.
A crash between acceptance and acknowledgment must permit safe redelivery.
Dispatch identity is specific to admitted work, not a universal client command
receipt or an authorization to replay commands.

Distinct SQLite connections do not share a transaction. Do not claim atomicity
between a Drizzle write and Effect SQL persistence merely because they use the
same file. Bridge that boundary with committed outbox intent and replay.
No asynchronous work or external I/O belongs inside a domain transaction.
Do not nest a writer transaction on another connection while holding one open.

### Cancellation and publication

Explicit user cancellation persists cancellation intent and fences future domain
publication. Use `cancelling` while interruption and cleanup remain outstanding;
report `cancelled` only after the defined local cancellation obligations finish.
Repeated cancellation must be safe and restart must preserve its intent.

Publication must use a scoped guard tied to the current domain work generation.
In the same transaction as result writes, validate cancellation, deletion, and
obsolescence before committing. A check before external work is insufficient.
Guard lifetime and ownership must not escape their scope; cancellation and
publication must have a defined transaction ordering under races.
This guard is domain authorization, independent of execution ownership.

Already committed results remain committed. Cancellation cannot undo remote
side effects, and remote requests or usage may continue after local interruption.
Do not present `cancelled` as proof that a provider stopped processing or charging.
Deletion and supersession must also prevent stale recovered work from publishing.

### Recovery, retries, and compatibility

Preserve [Local mutation retry policy](local-mutation-retry-policy.md): client
commands require manual retry and must not be automatically replayed on reconnect
or restart. Recovering an already admitted workflow is a different operation.
It must not resubmit its initiating client mutation.

Activities may use bounded retry policies over canonical typed failures and
official durable waits. Define retryability, attempt limits, and exhaustion
behavior explicitly; do not match error messages. Preserve `StudyError` and
`ErrorKind` at domain boundaries, including adapter failure translation.

External exactly-once execution is not promised. If a provider accepted a request
but its result was not durably recorded, recovery may repeat the attempt.
An unknown AI attempt may incur repeated usage and produce a different result.
Use provider idempotency where actually supported; it does not establish a
universal exactly-once guarantee.

Workflow and activity names are persisted protocol identities and must be stable.
Payloads and results use canonical schemas with explicit compatible versions.
Renames, schema changes, and activity reordering require replay compatibility
review against persisted work. Unsupported work must appear visibly blocked with
a typed reason, rather than disappear, loop indefinitely, or decode unsafely.

### Database ownership

Drizzle owns domain schema and migrations. Official Effect SQL infrastructure
owns its prefixed execution tables and migrations in the same SQLite database.
Neither schema is duplicated in the other migration system.

`packages/db` owns domain connection and transaction primitives. Runtime
initialization owns ordered startup: complete Drizzle domain initialization and
Effect infrastructure migrations before accepting work or starting consumers.
Migration failure blocks readiness and is exposed as a typed startup failure.
The infrastructure table prefix is a stable persistence identity; changing it
creates a different execution namespace, not an upgrade.

Domain schema generation and drift checks must exclude Effect-owned tables while
still detecting domain drift. Infrastructure migration history and compatibility
must be checked through the pinned official migration mechanism. Neither system
may delete or recreate tables owned by the other.

Backup and restore ownership belongs to application database lifecycle tooling:
produce a consistent SQLite backup containing domain data, outbox, execution
messages, replies, and both migration histories together. Copying a live main
file alone is insufficient with WAL. Restore only while runners and writers are
stopped, then validate both schemas before resuming. Independently restoring
domain and execution snapshots violates dispatch and publication guarantees.

### Progress and bounded resources

Persist authoritative progress snapshots and terminal outcomes in domain state.
Transient token deltas may be streamed without persistence; reconnect reads the
latest durable snapshot and need not reconstruct every token. Commit state before
publishing notifications. Localize user-visible states and errors in English and
Italian through `@study/localization`.

Use native scoped Effect resource permits for bounded concurrency and release on
failure, interruption, and scope closure. Workloads require fair bounded admission
and dispatch so bulk jobs cannot starve interactive work. Bound queues, batches,
fanout, retry attempts, and resource-specific concurrency.
Do not hold a resource permit while waiting to acquire another permit or while
holding a database transaction. Durable waits release scarce execution resources;
resource ownership must not survive restart as an assumed in-memory entitlement.

## Rationale

Official execution infrastructure consolidates persistence and recovery semantics
in the upstream Workflow stack. SingleRunner fits the embedded process without
introducing distributed deployment obligations. SQL messages and replies retain
durability even when runner coordination is in memory. The domain outbox bridges
separate transaction boundaries, while publication guards enforce domain authority
independently of execution recovery.

## Tradeoffs and limitations

The upstream cluster APIs require compatible package pins and deliberate upgrade
verification. Two schema owners and separate connections add migration ordering,
contention, backup, and replay obligations. Durable execution does not provide
remote exactly-once behavior or execution while the application is fully stopped.
A separate worker service, multi-machine cluster, and hidden resident daemon are
outside this architecture.

## Architectural enforcement

Types enforce stable identities, canonical schemas, typed errors, and scoped
capabilities. Lints enforce layering and prohibit parallel execution machinery.
Real SQLite semantic integration tests enforce official layer and adapter
compatibility, durable dispatch acceptance, and restart recovery of activities,
replies, and waits alongside Drizzle domain data.

These tests cover crash boundaries around outbox acceptance and acknowledgment,
shutdown versus explicit cancellation, cancellation/deletion/obsolescence
publication races, and writer contention across actual connections. They enforce
bounded retries, fairness, permit release, unsupported-version visibility, and
consistent backup and restore. Mocks alone cannot establish these guarantees;
static checks cannot establish temporal ordering or crash recovery semantics.

An upstream limitation that prevents these guarantees requires architectural
reconsideration. Study does not compensate with a custom scheduler, lease or
checkpoint system, or recovery engine.
