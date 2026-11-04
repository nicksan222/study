# Relational modelling workshop

A relational model represents facts as rows with named attributes. A primary key identifies a row, while foreign keys require references to existing rows. Display names should not be treated as immutable identifiers.

## Enrolment example

Students and courses have a many-to-many relationship. An enrolment table records each pairing, with a unique constraint on the student and course keys. A grade belongs to the enrolment rather than to the student alone.

## Normalisation

Separating course details from enrolments avoids updating the course title in many places. Dependencies determine where facts belong. Normalisation reduces update anomalies; it does not mean that every attribute needs its own table.

## Query design

An inner join returns matching rows. A left join preserves unmatched rows from its left input. A filter on a nullable right-side attribute can change the practical meaning of a left join, so check where conditions are applied.

## Consistency

A transaction groups related changes. Database constraints protect invariants even when multiple callers write concurrently or a process stops unexpectedly. Application validation improves feedback but does not replace durable constraints.

## Practice

Model student enrolment, then write a query listing all courses and their enrolment counts, including courses with zero students. Explain which join preserves those courses and why counting a nullable joined key matters.
