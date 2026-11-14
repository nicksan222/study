# Reactive RPC client

- Status: Accepted
- Date: 2026-11-14

## Decision

Study uses Effect v4 RPC, reactive primitives, and the official Effect React
bindings for application server state. TanStack React Query is removed completely.
Study supplies a thin typed integration, not a second query engine or a recreation
of TanStack's options API.

### Effect-first implementation

Use official Effect v4 capabilities wherever they provide the required semantics:

- `Schema` and Effect RPC own validation, typed contracts, and transport.
- `Atom`, `AsyncResult`, `AtomRegistry`, and the official React bindings own
  reactive client state, shared reads, subscriptions, and rendering integration.
- `Reactivity` connects typed dependency invalidation to reads within each process;
  `Stream` carries live snapshots and composes event processing.
- Effect services and `Layer` compose dependencies; `Scope` and scoped fibers own
  resource lifetime, interruption, and cancellation; `Schedule` expresses retry,
  backoff, and periodic reconciliation policies.

Reuse the existing platform database, transaction, transport, and workflow services.
Study-specific infrastructure is limited to domain dependency/change declarations,
the durable database revision and reconciliation bridge, and thin adapters needed
for the agreed public API and semantics. Do not build a parallel cache, scheduler,
subscription framework, or resource-management system. Compose official primitives
before adding custom mechanisms, and keep any necessary adaptation at the shared
boundary rather than repeating it in features or components.

Use `AtomRpc` where its semantics fit. Live snapshots require continuous
latest-value consumption, so its streaming pull/accumulation interface must not
be forced into that role. The adapter must use the appropriate Effect stream and
atom primitives without replacing their execution machinery.

### One contract and one React import

`@study/contracts` owns the canonical typed endpoint definitions. Its React-free
RPC entry point serves the server and non-React consumers. A dedicated
`@study/contracts/react` entry point exports one `rpc` object:

```tsx
import { rpc } from '@study/contracts/react';

const sources = rpc.sources.list.useQuery({ projectId, limit: 50 });
const rename = rpc.sources.rename.useMutation();

rename.mutate({ id: sourceId, name });
```

This illustrates the public interface; these are Study adapters, not
built-in Effect APIs. Names describe feature operations without repeating the
feature name. Inputs, successful results, and errors are inferred from the same
schemas used on the wire. A separate handwritten client endpoint inventory is
not permitted.

Endpoint constructors distinguish live queries, mutations, and event streams.
Only live queries expose `useQuery`; only mutations expose `useMutation`.
Event streams use a distinct subscription interface: an ordered progress stream
must not accidentally become a latest-snapshot query. TypeScript must reject
invalid hook/endpoint combinations and invalid input shapes.

The React entry point owns generic bindings and the typed facade. Application
composition supplies the scoped runtime and transport configuration. Endpoint
discovery, native APIs, and host detection remain in the shared client's host
boundary. Importing schemas or RPC definitions must not import React, server
implementations, database code, or initialize a network connection.

This clarifies the contracts-package responsibility in
[Shared application client](shared-application-client.md): it may expose optional
React bindings for its protocol. Screens, local state, routing, and application
composition remain in `apps/client`.

### Server-owned live queries

Every enabled mounted `useQuery` receives an initial authoritative snapshot and
subsequent snapshots after relevant committed changes, including changes from
background work and other windows. Components neither declare invalidation keys
nor invalidate caches after mutations. Changing query input switches the
subscription; results from the previous input must not replace the new result.

The owning feature declares a query's typed dependencies centrally. Dependency
keys represent application read dependencies, with branded identifiers where
scoped IDs are used. They cover collection membership, ordering, filters, counts,
and joined data as well as individual records. Query constructors require a
dependency declaration; mutation/store constructors require a typed change
declaration. Purely external operations explicitly declare that they make no
database changes. Declarations are part of the canonical typed definitions, not
conventions inferred from method names or strings in component code.

Server services execute the reads through private stores. Reactive infrastructure
reruns those reads and streams complete authoritative query snapshots over
Effect RPC. It must consume streams continuously into latest-value atoms;
Effect's `AtomRpc` pull/accumulation behavior must not be mistaken for a live
snapshot adapter. Intermediate snapshots may be coalesced. A live query is not an
audit log and does not promise delivery of every intermediate database state.

### Committed changes and recovery

Transactions preserve
[Feature services and stores](feature-services-and-stores.md). Services own
transaction boundaries; stores retain private persistence access. No transaction
contains asynchronous work or network I/O. All service paths, including workflows
and cross-feature transaction participants, participate in change tracking.

The database stores monotonic revisions for declared dependency scopes. A write
and advancement of every affected scope's revision commit atomically; rollback
advances nothing. Revision storage belongs to the single Drizzle-owned database.
Use bounded feature/collection scopes initially; narrower scopes may reduce
unnecessary reads when their lifetime and cleanup are defined. Revision metadata
must not itself cause an endless stream of change notifications.

Post-commit notifications wake reactive readers quickly. They are hints, never
the only evidence of a change. While subscriptions exist, shared server
reconciliation checks durable revisions on a bounded configured interval and
refreshes readers that missed a hint. Reconciliation is shared and batched, rather
than a polling timer per component. Existing durable workflow events keep their
job-dispatch role; UI refresh does not introduce a second workflow engine or
assume that workflow events describe every database write.

A subscription registers observation before its initial read. Its snapshot and
observed revisions are read consistently; changes racing with setup or a refresh
leave it dirty and cause another read. Only revisions covered by a successful
snapshot may be acknowledged. Notifications are coalesced without clearing a
newer change. These guarantees must hold for dependency changes and composed
reads, not just a single-table example.

Transport liveness is monitored with a bounded timeout. A disconnected or stalled
subscription reconnects and reads a fresh snapshot, without relying on the old
connection's event history. Database replacement or restore invalidates the
revision generation and all existing subscriptions. Revision numbers from
different generations must never be compared as if they were continuous.

The guarantee is eventual convergence to committed state while the service,
connection, and query can make progress. Healthy notifications provide prompt
updates; missed hints are recovered within the configured reconciliation interval
plus query/transport time. No fixed real-time deadline is promised under overload
or failure. Reconciliation and liveness intervals are explicit runtime settings
with tested bounds, not implicit infinite waits.

### Ownership, state, and failures

One client registry shares a live query for the same endpoint, canonical input,
and connection/security context. Render count must not multiply subscriptions.
Server work is scoped to active subscribers. Releasing the final subscriber
cancels its stream and read work; reconnect replaces, rather than duplicates,
subscriptions. Cached snapshots may have a bounded idle lifetime, but cached
values alone do not keep server work running. Cross-client server deduplication
is an optimization, not a requirement or a reason to mix security contexts.

Query state retains Effect's typed asynchronous result semantics and explicitly
exposes refreshing, stale/disconnected, and failed states. A previous successful
snapshot may remain visible while refreshing or disconnected, but must not be
represented as fresh. Before the first success there is no fabricated empty
result. A failed refresh retains the failure even when previous data is available.
Data invalidated by an authorization failure must not remain visible. Domain
failures use the canonical error schema and `ErrorKind`; transport failures remain
distinguishable. Components decide presentation using localized copy.

Transient read/transport failures use a bounded backoff policy and can recover
without user mutation or component invalidation. Non-retryable domain failures
are exposed without a hot retry loop; changed dependencies or explicit retry can
attempt the read again. The runtime retains ownership of recovery after a stream
fails instead of leaving a permanently abandoned mounted query.

Mutations run through the same typed protocol and expose pending, success, and
failure state. Concurrent calls have separate execution identities and their own
results; one call cannot resolve with another call's result or cancel it merely
because both use the same endpoint. Transport recovery never automatically
replays a mutation. A lost response can leave its outcome unknown; a caller must
not infer rollback from a transport error. Retry-safe behavior requires an
explicit endpoint idempotency contract. Unmounting a caller is not a promise to
undo a committed write or cancel durable work.

A successful mutation means its declared operation completed, not that every
live view has already rendered its new snapshot. Durable-work initiation reports
acceptance and an identity, with progress observed separately. Live queries
converge through committed changes. Optimistic cache edits and offline mutation
queues are outside this decision; neither is required for the initial contract.

### Other client consumers

Local drafts and interaction state use ordinary atoms or React state. They are
not RPC query results and must survive connection recovery without being reset.
Native-host asynchronous operations use the same Effect state primitives through
the host boundary without pretending to be server RPCs.

Imperative reads, route loaders, and preloading use the same endpoint definitions
and scoped runtime. One-shot reads return a snapshot without leaving a permanent
subscription; preloaded values cannot bypass live reconciliation on mount.
Loading and Suspense are adapters over the same result state, not separate caches.

Pagination remains bounded and schema-defined. Mounted pages stay reactive;
changes that affect cursor membership or ordering require refreshing the
affected loaded sequence so it cannot silently accumulate gaps or duplicates.
Refreshing may reset the continuation position. Pages are not a promise of a
historical database snapshot across navigation. Imperative consumers must request
additional pages explicitly rather than silently collecting an unbounded list.

## Enforcement

TypeScript and canonical constructors enforce endpoint classification, schema
inference, hook availability, typed dependency/change declarations, branded IDs,
and typed failures. Scope/runtime APIs enforce subscription and transaction
lifetimes. Prefer these guarantees to AST rules when the type system can express
the requirement. Application code must not bypass them with unchecked assertions.

Oxlint enforces remaining import and ownership boundaries, including preventing
alternative client execution paths and React Query reintroduction. It must not
duplicate rules already guaranteed by the canonical types.

Types cannot prove that declared dependencies cover a SQL predicate or that every
write reports the correct changes. Real SQLite and native RPC integration tests
must verify rollback, background and cross-client writes, list membership and
ordering, setup/refresh races, missed notifications without disconnection,
reconnect/restore, cancellation/deduplication, concurrent mutation result identity,
and failure/stale-state behavior. Type-level tests verify invalid constructions.

## Rationale

One Effect-based execution and state model preserves typed errors, cancellation,
and resource ownership across the application. A small ergonomic facade lets
components consume the protocol without duplicating transport or refresh policy.
Server-owned dependencies make background work and other clients behave like
local mutations. Persisted revisions make correctness independent of notification
delivery while keeping SQLite authoritative.

## Accepted tradeoffs

- The application owns a small facade and recovery integration. Official Effect
  primitives supply execution and reactivity; their unstable APIs require pinned
  versions and deliberate upgrade verification.
- Live queries consume server resources and may resend full snapshots. Bounded
  reads, shared subscriptions, coalescing, and batched reconciliation limit work;
  fine-grained deltas and cross-client computation sharing are optional later
  optimizations.
- Coarse dependency scopes can refresh more queries than necessary. This is
  preferable to silently stale results; narrowing requires semantic tests.
- Supported writers go through the application services and transactional change
  tracking. Arbitrary external SQLite edits are outside the reactive guarantee.
  Time-dependent or external-resource reads require an explicit server refresh
  source; database revisions alone cannot make them reactive.
- This does not provide offline synchronization, collaborative editing conflict
  resolution, exactly-once network delivery, or atomic rendering across separate
  queries. Data requiring one consistent snapshot belongs in one query contract.
