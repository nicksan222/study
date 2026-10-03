---
name: sqlite-persistence
description: Use when planning or implementing schema, queries, migrations or data integrity in Study's single SQLite database.
---

# One SQLite database

- Read the module docs in `crates/study-core/src/`. `study-core` is the only crate that
  opens SQLite. Never create a separate database file for a feature.
- Settings need no schema change. Declare them with `preferences!` in the crate that owns
  the feature.
- Bind every parameter. Put multi-statement writes in one transaction, and enqueue any jobs a
  write causes in that same transaction. Publish bus events only after the commit.
- Store enums as text with a `CHECK` list. Keep one Rust mapping per enum and a round-trip
  test against the `CHECK` list.
- Test against `Database::temporary()` or `Store::temporary()` (the `seed` feature).
- Keep blocking database work off the GPUI thread and the async runtime. Don't hold a
  connection across `.await`.
