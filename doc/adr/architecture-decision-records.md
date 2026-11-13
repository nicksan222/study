# Architecture decision records

- Status: Accepted
- Date: 2026-11-13

## Decision

Accepted architecture decisions must live in `doc/adr`. Each record must describe
one coherent architectural decision and define how the system must be structured
or behave.

Decisions must be discussed and agreed before they are recorded. A record may
define an agreed target that requires implementation; recording it must not imply
that the implementation has already been verified.

### Names

Use descriptive, lowercase, kebab-case filenames that name the decision, such as
`shared-application-client.md`. Do not use sequence numbers, dates, placeholder
names, or generic labels as filenames. The document title must name the decision
in plain language. Link to records by their descriptive titles.

### Contents

Every record must contain:

- **Status and date:** identify it as accepted and state the acceptance date.
- **Decision:** state the required structure, responsibilities, boundaries, or
  behavior precisely enough to guide implementation and review.
- **Rationale:** explain why these requirements are appropriate.
- **Accepted tradeoffs:** identify the costs and limitations deliberately accepted.

Add constraints, scope, or reconsideration criteria when they clarify the
decision. Describe the required architecture directly. Exclude discussion
transcripts, proposals, previous architecture, migration steps, implementation
activity logs, and lists of abandoned alternatives.

Records must stay concise and avoid duplicating implementation details that are
better expressed in code, types, tests, or lints.

### Changes

Clarifying wording must preserve the accepted meaning. A change to an
architectural requirement requires agreement before its record is updated.
Records must describe the agreed requirements; Git history retains their prior
versions.

## Rationale

A short, prescriptive record gives contributors a stable architectural contract
without requiring them to reconstruct a conversation. Descriptive names make
decisions discoverable by subject.

## Accepted tradeoffs

- Records omit the full deliberation and previous designs. Their purpose is to
  communicate the agreed contract and its reasoning.
- Keeping records concise leaves detailed implementation evidence in code and
  verification results.
- Records require maintenance when architectural requirements change. They must
  not be updated merely to legitimize an unagreed implementation.
