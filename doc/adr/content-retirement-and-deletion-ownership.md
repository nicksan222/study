# Content retirement and deletion ownership

- Status: Accepted
- Date: 2026-11-15

## Decision

### Delete owned data, not everything related to it

Each feature defines the data its entities own and removes that data through its
public service. This rule applies to current and future entity types.

A link, project membership, attachment, citation, or derivation does not by itself
make one entity own another. Independently published artifacts survive deletion
of the note or other input that produced them. Deleting a note, for example,
does not also delete independently published Pages or learning artifacts.
Deleting an independent artifact requires its own accepted deletion scope.

Cross-feature cleanup uses the owning features' public synchronous transaction
participants. A feature must not delete another feature's private data directly.

### Archive, retire history, and delete are different operations

- **Archive** preserves content and identity. The feature defines how archived
  entities appear and whether they can participate in new operations.
- **Retire history** removes the selected version bodies. It preserves historical
  identities and only the version metadata explicitly retained by that operation's
  contract. It does not delete the entity or its retained versions.
- **Delete an entity** makes it unavailable and removes its owned content,
  descriptive text, instructions, annotations, and private working copies.
  Only minimal identity, dependency, and operation records may remain.

Retirement and deletion must respect independently owned copies. They must not
erase another artifact merely because it contains the same text or a quotation.

### References state what must remain readable

Canonical typed reference contracts define their retention obligations:

- A **body-retaining reference** requires its exact target to remain readable.
  It blocks removal of that body until the dependency is explicitly released or
  its owner is included in an accepted cleanup scope.
- An **identity-only reference** can survive removal of its target's body.
  Readers preserve the original identity and explicitly report unavailable
  evidence, following [Immutable content versions and evidence provenance](immutable-content-and-evidence-provenance.md).

Do not silently weaken a retention obligation, follow a newer version, or retain
private working copies merely because a historical reference still exists.
These obligations belong in feature contracts and enforcement; they do not
require a universal reference registry or one deletion implementation for all
entity types.

### Acceptance blocks access and late publication

Before acknowledging deletion or retirement, commit its exact scope and the
barrier that makes the affected content unavailable. Commit any required durable
cleanup intent in the same transaction. Existing work must lose authority to
publish into that scope. A retry, late result, or restart must not recreate it.

When an operation uses an impact preview, acceptance must verify the reviewed
scope and relevant dependencies. A changed scope requires a fresh preview.
Where an operation exposes an acceptance receipt, replay preserves its original
scope and identity.

### Completion means cleanup finished

Acceptance is not completion. Cleanup may finish in the accepting transaction
or continue through the official durable-work infrastructure. Pending and failed
cleanup remain discoverable and can resume without making content readable again.
Durable cleanup retries preserve the accepted operation identity and cannot
expand its scope.

An operation whose data cleanup commits synchronously need not add a receipt or
status endpoint. A repeated call may report that the content is already
unavailable. A lost response or post-commit interruption failure does not imply
rollback, following [Local mutation retry policy](local-mutation-retry-policy.md).

Report completion only after the owning features' cleanup obligations finish,
including removal of private captured inputs and outputs from affected execution
records. Preserve independently committed results outside the accepted scope.

Retained receipts and retirement markers may keep identities, digests, typed
outcomes, and ownership proofs needed for safe replay and to prevent resurrection.
They must not keep removed bodies or private captured payloads. Entity deletion
must not retain user text merely to preserve an operation's status.

## Enforcement

Typed contracts define operation scope, retention obligations, and outcomes.
Feature services commit barriers and coordinate cleanup. Real SQLite and official
workflow tests verify dependency protection, stale previews, atomic rollback,
publication races, retry identity, restart recovery, payload cleanup, and
prevention of resurrection. Tests also verify that independent artifacts survive
and identity-only references expose unavailable evidence.

## Rationale

Ownership makes deletion predictable: removing a notebook entry does not silently
erase work the learner kept independently. Explicit reference obligations protect
necessary evidence without retaining every source forever. A committed barrier
keeps deletion effective while cleanup waits, fails, or resumes after restart.

## Accepted tradeoffs

- Retained dependencies can block removal until they are explicitly released.
- Content may be unavailable while cleanup is pending or failed.
- Minimal identities and receipts can outlive content bodies.
- Independent artifacts can retain their own text and quotations after an input
  is deleted; deleting the input does not promise deletion of those artifacts.
