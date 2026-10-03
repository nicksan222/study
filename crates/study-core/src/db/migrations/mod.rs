//! The schema and its migrations, applied in order to every database it opens.
//!
//! Released data is kept (`AGENTS.md`, rule 9). [`MIGRATIONS`] lists the schema's numbered
//! files in order, and a database's `user_version` says how many it has applied. A new
//! database applies them all; an older one applies the rest, each in a transaction of its
//! own, after copying itself beside its file as `study-before-v{n}.sqlite3` (only the newest
//! copy is kept); one made by a newer Study is refused. A shipped migration never changes:
//! a test pins each one by its SHA-256.
//!
//! `0001_initial.sql` is the baseline. Its SHA-256 is stored in `schema_meta`, so a database
//! made from another version of it, by a development build from before the first release,
//! is refused with a hint to reset, instead of failing later on a missing column.
//!
//! # Changing the schema
//!
//! - Before the first release, edit `0001_initial.sql` in place and update its pin. After,
//!   add the next numbered file here, to [`MIGRATIONS`] and to the pins.
//! - Every column holding a `text_enum!` references the `codes_<enum>` table of its codes. A
//!   new code is a row there: an `INSERT` in `0001_initial.sql` before the first release, in
//!   a new migration after. Renaming a code takes one migration that updates its row and
//!   every column holding it; the foreign key check before it commits catches a column
//!   missed. A new enum column adds its codes table, and its row in
//!   `check_lists_match_the_rust_enums`.
//! - Changing a cross-column `CHECK` takes SQLite's twelve-step table rebuild
//!   (<https://www.sqlite.org/lang_altertable.html#otheralter>). Foreign keys are off while a
//!   migration runs, and checked before it commits.

use crate::{Context as _, ErrorKind, Result, bail};
use rusqlite::{Connection, OptionalExtension as _};
use sha2::{Digest as _, Sha256};
use std::{fs, io, path::Path};

pub(super) const INITIAL: &str = include_str!("0001_initial.sql");

/// The schema's migrations, in order.
const MIGRATIONS: &[&str] = &[INITIAL];

/// Brings a database up to the latest schema: see the module docs.
pub(super) fn apply(connection: &mut Connection) -> Result<()> {
    migrate(connection, MIGRATIONS)
}

/// Brings a database up to `migrations`, the first of them its baseline.
fn migrate(connection: &mut Connection, migrations: &[&str]) -> Result<()> {
    let latest = migrations.len();
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let applied = usize::try_from(version)
        .ok()
        .filter(|&applied| applied <= latest);
    let Some(applied) = applied else {
        bail!(
            ErrorKind::Unsupported,
            "this database was made by a newer Study (schema version {version}, this one \
             knows {latest}); update Study to open it"
        );
    };
    let baseline = sha256_hex(migrations[0]);
    if applied > 0 {
        // A database without `schema_meta` is from another schema too.
        let has_meta: bool = connection.query_row(
            "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE name = 'schema_meta')",
            [],
            |row| row.get(0),
        )?;
        let stored: Option<String> = if has_meta {
            connection
                .query_row(
                    "SELECT value FROM schema_meta WHERE key = 'sha256'",
                    [],
                    |row| row.get(0),
                )
                .optional()?
        } else {
            None
        };
        if stored.as_deref() != Some(baseline.as_str()) {
            bail!(
                "this database was created by a different development version of Study; \
                 run `just reset-data` (or delete the file) to start over"
            );
        }
        if applied == latest {
            return Ok(());
        }
        back_up(connection, latest)
            .context("cannot back up the database before upgrading it, so it was left as it was")?;
    }
    // A no-op inside a transaction, so off around them, and checked before each commits.
    connection.pragma_update(None, "foreign_keys", false)?;
    let migrated = apply_from(connection, migrations, applied, &baseline);
    connection.pragma_update(None, "foreign_keys", true)?;
    migrated
}

/// Applies `migrations` after the first `applied`, each in its own transaction that also
/// records it in `user_version`.
fn apply_from(
    connection: &mut Connection,
    migrations: &[&str],
    applied: usize,
    baseline: &str,
) -> Result<()> {
    for (index, migration) in migrations.iter().enumerate().skip(applied) {
        let version = index + 1;
        let tx = connection.transaction()?;
        tx.execute_batch(migration)
            .with_context(|| format!("cannot apply schema migration {version}"))?;
        if version == 1 {
            tx.execute_batch(
                "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            )?;
            tx.execute(
                "INSERT INTO schema_meta (key, value) VALUES ('sha256', ?1)",
                [baseline],
            )?;
        }
        let broken: i64 =
            tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        if broken > 0 {
            bail!("schema migration {version} leaves {broken} rows referring to nothing");
        }
        tx.pragma_update(None, "user_version", version as i64)?;
        tx.commit()
            .with_context(|| format!("cannot apply schema migration {version}"))?;
    }
    Ok(())
}

/// Copies the database beside its file before it is upgraded to `version`, private to its
/// owner, and then removes the copies made before older upgrades.
fn back_up(connection: &Connection, version: usize) -> Result<()> {
    let database = connection
        .path()
        .filter(|path| !path.is_empty())
        .map(Path::new)
        .context("the database has no file")?;
    let folder = database.parent().unwrap_or(Path::new("."));
    let name = format!("study-before-v{version}.sqlite3");
    let copy = folder.join(&name);
    // VACUUM INTO writes only into a missing or empty file.
    match fs::remove_file(&copy) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error.into()),
        _ => {}
    }
    #[cfg(unix)]
    super::open::make_private(&copy)?;
    connection.execute("VACUUM INTO ?1", [copy.to_string_lossy()])?;
    for entry in fs::read_dir(folder)? {
        let older = entry?.file_name().to_string_lossy().into_owned();
        if older.starts_with("study-before-v")
            && older.ends_with(".sqlite3")
            && older != name
            && let Err(error) = fs::remove_file(folder.join(&older))
        {
            tracing::warn!(%error, older, "cannot remove an older database copy");
        }
    }
    Ok(())
}

/// The SHA-256 of `text`, in hex, as stored in `schema_meta`.
fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::fs;

    /// Every shipped migration's file and SHA-256, in order. A shipped migration never
    /// changes; before the first release `0001_initial.sql` is edited in place, with its pin.
    const SHIPPED: &[(&str, &str)] = &[(
        "0001_initial.sql",
        "ca99b0c1bf507ed0985a7f68435ead52517124205b740e54e89d918fe7c5d3f1",
    )];

    /// A later migration for the tests: a new table and a new job kind.
    const SECOND: &str = "CREATE TABLE later (
            kind TEXT NOT NULL REFERENCES codes_job_kind(code)
        );
        INSERT INTO codes_job_kind (code) VALUES ('later');";

    /// The database file in `dir`, opened as the app opens one, before any migration.
    fn connect(dir: &Path) -> Result<Database> {
        Database::connect(dir.join("study.sqlite3"))
    }

    fn user_version(database: &Database) -> Result<i64> {
        Ok(database
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    /// Every table, index and trigger, with the SQL that made it.
    fn schema(database: &Database) -> Result<Vec<(String, String, Option<String>)>> {
        let mut statement = database
            .connection
            .prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name")?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    fn backups(dir: &Path) -> Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(dir)? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if name.starts_with("study-before-") {
                names.push(name);
            }
        }
        Ok(names)
    }

    #[test]
    fn shipped_migrations_never_change() -> Result<()> {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/migrations");
        let mut files = Vec::new();
        for entry in fs::read_dir(&folder)? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if name.ends_with(".sql") {
                files.push(name);
            }
        }
        files.sort();
        let pinned: Vec<&str> = SHIPPED.iter().map(|(file, _)| *file).collect();
        assert_eq!(files, pinned, "every migration file is pinned, in order");
        assert_eq!(
            MIGRATIONS.len(),
            SHIPPED.len(),
            "every pinned file is a migration"
        );
        for (migration, (file, sha256)) in MIGRATIONS.iter().zip(SHIPPED) {
            assert_eq!(fs::read_to_string(folder.join(file))?, *migration, "{file}");
            assert_eq!(
                sha256_hex(migration),
                *sha256,
                "{file} changed after it shipped"
            );
        }
        Ok(())
    }

    #[test]
    fn a_database_at_any_version_migrates_to_the_schema_a_fresh_one_gets() -> Result<()> {
        let migrations = [INITIAL, SECOND];
        let fresh_dir = tempfile::tempdir()?;
        let mut fresh = connect(fresh_dir.path())?;
        migrate(&mut fresh.connection, &migrations)?;
        let expected = schema(&fresh)?;
        for applied in 1..=migrations.len() {
            let dir = tempfile::tempdir()?;
            migrate(&mut connect(dir.path())?.connection, &migrations[..applied])?;
            let mut reopened = connect(dir.path())?;
            migrate(&mut reopened.connection, &migrations)?;
            assert_eq!(schema(&reopened)?, expected, "from version {applied}");
            assert_eq!(user_version(&reopened)?, 2, "from version {applied}");
        }
        Ok(())
    }

    #[test]
    fn a_database_from_a_newer_study_is_refused() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut database = connect(dir.path())?;
        migrate(&mut database.connection, &[INITIAL, SECOND])?;
        let error = migrate(&mut database.connection, &[INITIAL]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Unsupported);
        assert!(error.to_string().contains("newer Study"), "{error}");
        assert_eq!(user_version(&database)?, 2);
        Ok(())
    }

    #[test]
    fn a_database_from_another_schema_is_refused_with_a_hint() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut database = connect(dir.path())?;
        apply(&mut database.connection)?;
        apply(&mut database.connection)?;
        database.connection.execute(
            "UPDATE schema_meta SET value = 'old' WHERE key = 'sha256'",
            [],
        )?;
        let error = apply(&mut database.connection).unwrap_err().to_string();
        assert!(error.contains("just reset-data"), "{error}");
        database
            .connection
            .execute_batch("DROP TABLE schema_meta")?;
        let error = apply(&mut database.connection).unwrap_err().to_string();
        assert!(
            error.contains("just reset-data"),
            "without schema_meta: {error}"
        );
        Ok(())
    }

    #[test]
    fn a_failing_migration_changes_nothing() -> Result<()> {
        let broken = [
            "CREATE TABLE half (id INTEGER); INSERT INTO missing VALUES (1);",
            // Foreign keys are off while it runs, so only the check before committing sees it.
            "CREATE TABLE half (kind TEXT REFERENCES codes_job_kind(code));
             INSERT INTO half VALUES ('unknown');",
        ];
        for migration in broken {
            let dir = tempfile::tempdir()?;
            let mut database = connect(dir.path())?;
            migrate(&mut database.connection, &[INITIAL])?;
            assert!(migrate(&mut database.connection, &[INITIAL, migration]).is_err());
            assert_eq!(user_version(&database)?, 1, "{migration}");
            assert!(!schema(&database)?.iter().any(|(_, name, _)| name == "half"));
            let foreign_keys: bool =
                database
                    .connection
                    .query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
            assert!(foreign_keys, "foreign keys are back on");
        }
        Ok(())
    }

    #[test]
    fn an_upgrade_keeps_a_private_copy_of_the_database_first() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut database = connect(dir.path())?;
        migrate(&mut database.connection, &[INITIAL])?;
        assert!(
            backups(dir.path())?.is_empty(),
            "a new database needs no copy"
        );
        database.create_project("Physics")?;
        drop(database);
        fs::write(dir.path().join("study-before-v1.sqlite3"), b"an older copy")?;

        let mut database = connect(dir.path())?;
        migrate(&mut database.connection, &[INITIAL, SECOND])?;
        assert_eq!(
            backups(dir.path())?,
            ["study-before-v2.sqlite3"],
            "only the newest"
        );
        let path = dir.path().join("study-before-v2.sqlite3");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
        }
        let copy = Database::connect(&path)?;
        assert_eq!(
            user_version(&copy)?,
            1,
            "the copy is from before the upgrade"
        );
        assert_eq!(copy.list_projects()?.len(), 1);
        Ok(())
    }

    #[test]
    fn an_upgrade_without_its_copy_is_refused() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut database = connect(dir.path())?;
        migrate(&mut database.connection, &[INITIAL])?;
        // Nothing can be written where the copy goes.
        fs::create_dir(dir.path().join("study-before-v2.sqlite3"))?;
        let error = migrate(&mut database.connection, &[INITIAL, SECOND]).unwrap_err();
        assert!(error.to_string().contains("back up"), "{error}");
        assert_eq!(user_version(&database)?, 1);
        Ok(())
    }

    /// Renaming a code in a migration updates its row and every column holding it; one
    /// column missed fails the foreign key check, and the migration rolls back.
    #[test]
    fn a_code_is_renamed_by_updating_its_row_and_every_column_holding_it() -> Result<()> {
        let row_only = "UPDATE codes_title_source SET code = 'typed' WHERE code = 'user';";
        let rename = "UPDATE codes_title_source SET code = 'typed' WHERE code = 'user';
            UPDATE sessions SET title_source = 'typed' WHERE title_source = 'user';";
        for (migration, renames) in [(row_only, false), (rename, true)] {
            let dir = tempfile::tempdir()?;
            let mut database = connect(dir.path())?;
            migrate(&mut database.connection, &[INITIAL])?;
            let project = database.create_project("Physics")?;
            let session = database.create_session(project.id, "Cells")?;
            let migrated = migrate(&mut database.connection, &[INITIAL, migration]);
            assert_eq!(migrated.is_ok(), renames, "{migration}");
            let stored: String = database.connection.query_row(
                "SELECT title_source FROM sessions WHERE id = ?1",
                [session.id],
                |row| row.get(0),
            )?;
            assert_eq!(stored, if renames { "typed" } else { "user" });
            assert_eq!(user_version(&database)?, if renames { 2 } else { 1 });
        }
        Ok(())
    }

    /// Every column that references a codes table, as `(table, column, codes)`, read from a
    /// migrated database; codes sorted.
    fn check_lists() -> Result<Vec<(String, String, Vec<String>)>> {
        let dir = tempfile::tempdir()?;
        let mut database = connect(dir.path())?;
        apply(&mut database.connection)?;
        let connection = &database.connection;
        let tables: Vec<String> = connection
            .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")?
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut lists = Vec::new();
        let mut referenced = Vec::new();
        for table in &tables {
            let references: Vec<(String, String)> = connection
                .prepare("SELECT \"from\", \"table\" FROM pragma_foreign_key_list(?1)")?
                .query_map([table], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            for (column, codes_table) in references {
                if !codes_table.starts_with("codes_") {
                    continue;
                }
                let codes: Vec<String> = connection
                    .prepare(&format!("SELECT code FROM {codes_table} ORDER BY code"))?
                    .query_map([], |row| row.get(0))?
                    .collect::<rusqlite::Result<_>>()?;
                lists.push((table.clone(), column, codes));
                referenced.push(codes_table);
            }
        }
        for table in tables.iter().filter(|table| table.starts_with("codes_")) {
            assert!(referenced.contains(table), "{table} is used by some column");
        }
        Ok(lists)
    }

    /// Every column holding a stored `text_enum!` references a codes table holding exactly its
    /// codes, in a migrated database, and every such column has an enum here. A new enum
    /// column is added to `expectations`.
    #[test]
    fn check_lists_match_the_rust_enums() -> Result<()> {
        use crate::db::messages::PartKind;
        use crate::db::{MessageRole, MessageStatus, TitleSource};
        use crate::processing::ExtractorKind;
        use crate::{
            ArtifactKind, ArtifactStatus, BlockKind, ErrorKind, JobKind, JobStatus, QuestionKind,
            QuestionStatus, Rating, Requirement, SourceKind, SourceOrigin, Verdict,
        };

        fn codes<T: Copy>(all: &[T], code: impl Fn(T) -> &'static str) -> Vec<String> {
            let mut codes: Vec<String> = all.iter().map(|value| code(*value).to_owned()).collect();
            codes.sort();
            codes
        }
        let mut expectations = vec![
            (
                "sources",
                "origin",
                codes(SourceOrigin::ALL, SourceOrigin::code),
            ),
            ("sources", "kind", codes(SourceKind::ALL, SourceKind::code)),
            (
                "sessions",
                "title_source",
                codes(TitleSource::ALL, TitleSource::code),
            ),
            (
                "messages",
                "role",
                codes(MessageRole::ALL, MessageRole::code),
            ),
            (
                "messages",
                "status",
                codes(MessageStatus::ALL, MessageStatus::code),
            ),
            (
                "message_parts",
                "kind",
                codes(PartKind::ALL, PartKind::code),
            ),
            (
                "message_parts",
                "source_kind",
                codes(SourceKind::ALL, SourceKind::code),
            ),
            ("blocks", "kind", codes(BlockKind::ALL, BlockKind::code)),
            (
                "artifacts",
                "kind",
                codes(ArtifactKind::ALL, ArtifactKind::code),
            ),
            (
                "artifacts",
                "status",
                codes(ArtifactStatus::ALL, ArtifactStatus::code),
            ),
            ("reviews", "rating", codes(Rating::ALL, Rating::code)),
            (
                "practice_questions",
                "kind",
                codes(QuestionKind::ALL, QuestionKind::code),
            ),
            (
                "practice_questions",
                "status",
                codes(QuestionStatus::ALL, QuestionStatus::code),
            ),
            (
                "practice_questions",
                "verdict",
                codes(Verdict::ALL, Verdict::code),
            ),
            ("jobs", "kind", codes(JobKind::ALL, JobKind::code)),
            (
                "documents",
                "extractor",
                codes(ExtractorKind::ALL, ExtractorKind::code),
            ),
            ("jobs", "status", codes(JobStatus::ALL, JobStatus::code)),
            ("jobs", "error_kind", codes(ErrorKind::ALL, ErrorKind::code)),
            (
                "jobs",
                "waiting_for",
                codes(Requirement::ALL, Requirement::code),
            ),
        ];
        let mut listed = check_lists()?;
        listed.sort();
        expectations.sort();
        let listed_columns: Vec<(&str, &str)> = listed
            .iter()
            .map(|(table, column, _)| (table.as_str(), column.as_str()))
            .collect();
        let expected_columns: Vec<(&str, &str)> = expectations
            .iter()
            .map(|(table, column, _)| (*table, *column))
            .collect();
        assert_eq!(
            listed_columns, expected_columns,
            "every codes column has an enum here, and every enum here has a codes column"
        );
        for ((table, column, listed), (_, _, expected)) in listed.iter().zip(&expectations) {
            assert_eq!(listed, expected, "{table}.{column}");
        }
        Ok(())
    }

    /// The statuses `source` names inline after a `status` column: one compared with `=` or
    /// `!=`, and each in an `IN (…)` list. Lists interpolated from a constant, such as
    /// `PENDING`, have tests of their own.
    fn statuses_named(source: &str) -> Vec<&str> {
        let mut named = Vec::new();
        for (at, _) in source.match_indices("status") {
            let rest = &source[at + "status".len()..];
            if rest.starts_with(|c: char| c.is_alphanumeric() || c == '_') {
                continue;
            }
            let rest = rest.trim_start();
            if let Some(value) = rest
                .strip_prefix("!=")
                .or_else(|| rest.strip_prefix('='))
                .and_then(|value| value.trim_start().strip_prefix('\''))
            {
                named.extend(value.split('\'').next());
            } else if let Some(list) = rest
                .strip_prefix("NOT IN")
                .or_else(|| rest.strip_prefix("IN"))
                .and_then(|list| list.trim_start().strip_prefix('('))
            {
                let list = &list[..list.find(')').unwrap_or(list.len())];
                named.extend(list.split(',').map(|code| code.trim().trim_matches('\'')));
            }
        }
        named
    }

    /// Every status the queries in `src/db` name inline is the code of a job, artifact,
    /// message or question status, so a typo or a renamed variant fails here rather than
    /// matching no rows.
    #[test]
    fn every_status_a_query_names_is_a_status_code() -> Result<()> {
        use crate::db::MessageStatus;
        use crate::{ArtifactStatus, JobStatus, QuestionStatus};

        let codes: Vec<&str> = JobStatus::ALL
            .iter()
            .map(|status| status.code())
            .chain(ArtifactStatus::ALL.iter().map(|status| status.code()))
            .chain(MessageStatus::ALL.iter().map(|status| status.code()))
            .chain(QuestionStatus::ALL.iter().map(|status| status.code()))
            .collect();
        let mut folders = vec![std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/db"
        ))];
        let mut checked = 0;
        while let Some(folder) = folders.pop() {
            for entry in std::fs::read_dir(folder)? {
                let path = entry?.path();
                if path.is_dir() {
                    folders.push(path);
                } else if path.extension().is_some_and(|extension| extension == "rs") {
                    let source = std::fs::read_to_string(&path)?;
                    for status in statuses_named(&source) {
                        assert!(codes.contains(&status), "{}: {status:?}", path.display());
                        checked += 1;
                    }
                }
            }
        }
        assert!(checked > 0, "the scan found no statuses at all");
        Ok(())
    }
}
