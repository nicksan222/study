# Immutable content versions and evidence provenance

- Status: Accepted
- Date: 2026-11-15

## Decision

### Entity identity and content identity

This decision applies to every content-bearing entity, including future entity
types. Sources, pages, messages, and learning artifacts are examples, not a
closed set. Each owning feature defines its canonical typed version identity
and exact input reference through the shared contracts.

An entity identifies a logical resource over time. Its current version is a
mutable selection. Persisted content versions and completed extraction snapshots
identify the content as it existed at a specific point; their content must not
be rewritten under the same identity.
Corrections, edits, replacement, and re-extraction create new content history.
Working drafts and incomplete streams may change until committed as a completed
version; they must not be presented as immutable evidence.

Extracted and authored content use the canonical anchored `Document` contracts.
Feature services own their version lifecycles. Shared contracts define content
identities and references; consumers must not introduce competing document or
provenance representations.

### Exact inputs and evidence

Persisted derived content must record the exact inputs used to produce it.
References identify the owning feature's exact content version, including a
completed extraction snapshot when extracted content was used. An entity ID,
current-head pointer, name, URL, or content hash alone is insufficient to identify
that input.
Capture exact inputs before generation and preserve their identities through
publication; later edits must not change what the recorded inputs mean.

Citations belong to the derived content version and reference its declared exact
inputs. Exact text evidence identifies a block and a valid range within that
input, with a quote and source anchor that match the referenced block. Source
anchors retain their source-location meaning; they do not substitute for content version
identity or canonical block ranges.

Evidence precision must remain explicit. A source-level reference or retained
quote without a resolvable exact range must not be presented as verified exact
text evidence. Readers and exporters must preserve the recorded input identity
and precision rather than silently resolving a reference against current content.

### Freshness and availability

Traceability, freshness, and availability are separate properties. New input
versions can make derived content outdated without changing its historical
evidence. Updating derived content creates a new version with its own exact
inputs; it must not rewrite the provenance of an existing version.

Historical evidence remains resolvable while its referenced content is retained
and readable. Retention and deletion may make it unavailable. Readers must expose
that unavailability explicitly and must not substitute newer content, reconstruct
deleted evidence from unrelated copies, or claim a retained quote proves the
original evidence is still available. This decision does not require indefinite
retention or override deletion boundaries.

Provenance establishes what content was used and where cited evidence came from.
It does not establish that a generated claim is correct or that a quote supports
it. Factual assessments remain separate from structural citation validation.

## Enforcement

Canonical schemas and branded identities express exact inputs. Owning services
validate input ownership, completion, citation membership, and exact ranges and
quotes before committing new derived content and its provenance atomically.

Real SQLite tests must verify that edits, replacement, re-extraction, and current
version changes preserve historical references; that invalid evidence cannot be
committed; and that retirement produces explicit unavailability without fallback.
Tests must distinguish outdated content from unavailable evidence and structural
validity from factual assessment.

## Rationale

Learners must be able to inspect what an answer or study artifact actually used,
even after their sources change. Separating entity identity from immutable
content identity makes citations stable and permits explicit updates without
silently changing the meaning of prior work. One canonical document model keeps
those guarantees consistent across extraction, authoring, and generation.

## Accepted tradeoffs

- Retained versions and provenance consume storage and require explicit retention
  and deletion behavior.
- Consumers must handle outdated content and unavailable evidence separately.
- Exact inputs support auditability, not deterministic regeneration: model output
  and external resources may differ on a later attempt.
- Structural citation validation cannot establish factual correctness.
