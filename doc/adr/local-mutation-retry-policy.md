# Local mutation retry policy

- Status: Accepted
- Date: 2026-11-15

## Decision

Study is local-only for now. Client mutations must not be automatically retried
or replayed, including during transport recovery, and must not enter an offline
mutation queue. Failures must be exposed through typed contracts; retrying a
failed operation requires an explicit user action.

A lost response can leave the mutation outcome unknown. A transport failure does
not imply rollback. An explicit user retry is a new attempt and can duplicate
non-idempotent effects unless the endpoint's existing explicit idempotency
contract guarantees retry safety.

Preserve existing feature-specific recovery, receipts, and guarantees. This
decision does not authorize code removal or weakening those guarantees. It does
not require universal deduplication, durable mutation receipts, status
endpoints, idempotency keys, or mutation identity infrastructure.

## Rationale

Local operation does not currently justify a general mutation recovery protocol.
Exposing failures and leaving retries to the user keeps recovery explicit
without assuming that a failed transport means an operation had no effect.
Endpoint contracts retain responsibility for any stronger retry guarantees.

## Accepted tradeoffs

- Users must explicitly retry failed mutations instead of receiving automatic
  recovery.
- An unknown outcome may require the user to inspect current state before
  retrying; a new attempt can duplicate effects without an endpoint guarantee.
- Mutation recovery guarantees remain feature-specific rather than universal.

## Scope and reconsideration

This decision governs client mutation retries. Background workflows and live
query reconnection and read retries remain unchanged, including the recovery
requirements in [Reactive RPC client](reactive-rpc-client.md).

Revisit this policy for remote, offline, or multi-user operation, or when
measured user experience needs justify stronger mutation recovery.
