# Feature services and stores

- Status: Accepted
- Date: 2026-11-14

## Decision

Feature services must own application operations, coordinate their dependencies,
and establish transaction boundaries. Each feature must keep its persistence
operations in private stores. RPC handlers and other features must access feature
behavior through the owning feature's public service rather than reaching into
its private stores. Services and RPC handlers must access persistence through
stores rather than issue SQL or use Drizzle directly.
Store queries may read shared tables; writes must respect feature table ownership.

Stores must use the typed store helpers. Their query and mutation names must be
valid lower-camel-case identifiers describing the operation. The helper must not
restrict query names to entity-derived singular, optional, or plural forms.
A store may expose several queries with the same result cardinality.

### Query contracts

Every query must declare its input schema, output schema, and result role through
`storeQuery`:

- `required` returns a result or produces a typed `not_found` failure.
- `optional` returns an explicit `Option`.
- `collection` accepts a bounded limit and returns an array or supported page
  within that limit.

The declared role must determine result handling independently of the method
name. Entity labels must supply diagnostic context, without restricting which
queries a feature can express.

Selective reads must express their filtering, ordering, and bounds in the store's
database query. Services must not page through a general listing merely to
implement a lookup the database can perform directly. Required identity, scope,
mode, and archive predicates must be preserved when selecting a result.

### Transactions and execution

Store execution callbacks must be synchronous. Store helpers must validate their
inputs and results.
Read views must expose queries only. Mutations must use `storeMutation` and may
execute only through an active transaction view.

Services must group related writes and durable event publication in the same
transaction. Cross-feature participation must use public synchronous service
participants with the caller's transaction. Database operations and transaction
capabilities must not escape their lifetime, and transactions must not contain
asynchronous work or external I/O.

## Enforcement

Oxlint must enforce canonical store constructors, valid operation identifiers,
explicit query roles, structurally bounded collection inputs, feature ownership,
service/store/RPC import boundaries, and the supported transaction APIs. The
`operation-conventions` rule must accept descriptive query names and multiple
queries of the same role.

TypeScript and the store runtime must enforce typed query and mutation views,
schema decoding, result cardinality, synchronous execution, rollback, and active
transaction lifetime. Real SQLite tests must verify those guarantees and the
semantics of feature-specific queries. Static linting does not establish whether
an arbitrary SQL predicate implements the correct business requirement.

Public service and RPC naming conventions remain separate from private store
query names.

## Rationale

The service/store boundary separates application coordination from persistence
while retaining atomic writes and explicit contracts. Descriptive queries let
features ask the database for the result they need, without creating extra stores
solely to satisfy a naming convention or transferring filtering into services.

## Accepted tradeoffs

- Private query names require feature-specific judgment instead of a universal
  three-name vocabulary.
- Typed descriptors and transaction wrappers add declarations and indirection in
  exchange for consistent validation, errors, instrumentation, and write safety.
- Oxlint enforces structural rules; runtime checks and database tests remain
  necessary for execution guarantees and semantic correctness.
