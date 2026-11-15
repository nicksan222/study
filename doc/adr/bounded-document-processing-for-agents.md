# Bounded document processing for agents

- Status: Accepted
- Date: 2026-11-15

## Decision

### One reusable document-processing capability

The server AI platform supplies shared planning and execution for agents that
consume canonical documents. Features reuse it instead of implementing their own
text splitting, traversal, or checkpoint machinery. It is independent of a
particular agent, provider, and output format.

A feature supplies its exact input references, processing policy, typed operation
for each piece, and rules for combining results. The platform owns piece bounds,
stable ordering and identities, execution bounds, and resumable intermediate work.
Agent prompts alone do not establish these guarantees.

The feature-facing entry point applies preparation around agent generation. A
feature declares its preparation policy once; callers supply captured inputs and
the task. Shared tooling loads those inputs, prepares bounded context and binds
original-evidence access to that call. Workflows do not assemble these steps
individually. Inputs that already fit may pass directly without an extra model
request.

Raw media decoding, ordinary short prompts, and structured tasks such as grading
one captured answer do not become document-processing jobs merely because they
use a model.

### Pieces preserve original content identity

Capture exact input versions before processing. Pieces are bounded views into
those inputs, not new documents or new sources. Preserve the original input,
block identity, ordinal, anchor, and canonical text range for each passage.
Splitting must not lose text, split a Unicode surrogate pair, or infer identity
from text. Repeated passages in distinct locations remain distinct evidence.

Validate piece plans and their schemas before provider work. Version the planning
policy and persist the accepted plan through the official execution infrastructure
so changes to defaults cannot silently repartition an admitted job on recovery.

### Declare complete or selected coverage

Each document-processing operation declares one of two policies:

- **Complete:** process every piece of the declared input scope before reporting
  successful processing. Selecting the first documents or blocks that fit a
  budget is not complete coverage.
- **Selected:** process explicitly selected passages for a focused task. Preserve
  which scope was selected; do not describe it as complete coverage of all inputs.

Limits apply to the whole plan as well as each piece. If the requested scope
cannot be processed within the declared limits, return a canonical typed failure
instead of silently dropping its end. Coverage describes which input was
processed; it does not prove that model output includes every fact or is correct.

### Process and combine within bounded budgets

Bound piece inputs, intermediate results, reduction inputs and outputs, total
piece count, and execution concurrency. State the units of each limit. Account
for serialized metadata and prompt overhead as well as passage text before
provider work. A bounded mapper followed by one unbounded aggregation is invalid.

The shared runner processes pieces with typed feature callbacks and combines
intermediate results in bounded groups, including multiple reduction levels when
needed. Features own the meaning of reduction, deduplication, and final output
validation. Combining flashcards is not the same operation as combining a
translation, and per-piece quizzes must not multiply a requested final count.

Intermediate summaries are derived data. They do not become original evidence.
Citation identities must remain unambiguous across pieces and reductions, and
final quotations and ranges must validate against the exact original inputs.

### Official durable execution and publication

Use native Effect Workflow and typed Activity results for the plan, mapped
pieces, and reductions. Do not add a parallel job, checkpoint, or recovery store.
Stable names include a feature namespace and processing-policy version.
Completed pieces must survive restart and outer-operation retries without being
recomputed merely because another piece failed.

Check cancellation, deletion, and input availability before further work. Final
publication remains a feature-owned transaction guarded by current domain
authority. Finishing some pieces does not authorize publishing a partial result
as a completed whole-input operation.

Preserve persisted workflow and Activity identities and result schemas. Changes
to orchestration require replay tests with existing completed replies and pending
work; they must not redispatch historical initiating events as new jobs.

## Enforcement

Shared schemas and planner tests verify complete reconstruction, stable ranges,
Unicode boundaries, selected scope, and typed limit exhaustion. Real SQLite and
official Workflow tests verify intermediate-result recovery, outer retry and
completed-Activity replay, cancellation, and publication fencing.

Consumer tests must include evidence beyond the former input prefix, bounded
multi-level reduction, invalid provenance, and feature-specific final constraints
such as exact quiz counts. Test providers are sufficient for these semantics;
model quality and exhaustive factual coverage are not deterministic guarantees.

## Rationale

Shared mechanics let each feature describe its task without rebuilding large-input
handling. Processing all declared pieces prevents input order from silently
deciding what an agent can see. Exact references keep generated work traceable,
while official Activity persistence avoids repeating completed model work.

## Accepted tradeoffs

- Large inputs require more model requests and can take longer.
- Intermediate results use durable storage and follow their owner's retention
  and deletion rules.
- Reduction can lose detail; features must choose semantics suitable for their
  task and must not claim factual completeness from processing coverage alone.
- Explicit limits can reject an oversized job instead of producing a partial
  result. Full and selected coverage remain deliberate feature policies.
