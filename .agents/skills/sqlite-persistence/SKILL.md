---
name: sqlite-persistence
description: Use when planning or implementing schema, queries, migrations or data integrity in Study's single SQLite database.
---

# One SQLite database

- Read the exports and owning types in `packages/db/src/`. `@study/db` owns SQLite.
  Never create a separate database file for a feature.
- Settings need no schema change. Store JSON preferences under the feature's existing
  scope and keys through the server preferences procedures.
- Bind every parameter. Put multi-statement writes and their jobs in the server transaction.
  Publish events only after commit; transaction callbacks must be synchronous.
- Define tables in domain files under `packages/db/src/schema/`, exported by its tiny
  barrel. Use Drizzle queries and Drizzle Kit generation; do not maintain a parallel SQL
  schema or a custom migration runner.
- Keep `@study/db` free of business rules, jobs, events and domain services. Those belong
  in `apps/server`, with procedure tests beside each procedure.
- The current server is a breaking reset. Do not add a legacy Rust data importer.
- Test against a real temporary SQLite file through `Db.open`, closing it in cleanup.
- Keep synchronous database work in the private server process, away from the UI.
  Never hold a transaction across an `await`.
