//! Locating and opening the application database.

use super::{Database, migrations};
use crate::{Context as _, Result};
use rusqlite::Connection;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

/// The database's file name, in the data directory or a temporary one.
pub(super) const DATABASE_FILE: &str = "study.sqlite3";
/// How long a write waits for another to finish; imports stream large files in one write.
const BUSY_TIMEOUT: Duration = Duration::from_secs(30);

impl Database {
    /// Platform-specific path for the one application database, creating its directory on
    /// first launch.
    pub fn default_path() -> Result<PathBuf> {
        crate::paths::data_file(DATABASE_FILE)
    }

    /// Opens the database, creating or checking its schema. Prefer a [`Store`](super::Store),
    /// which does this once and shares connections.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        #[cfg(unix)]
        make_private(path.as_ref()).context("cannot protect application database")?;
        let mut database = Self::connect(path)?;
        migrations::apply(&mut database.connection)?;
        Ok(database)
    }

    /// A fresh database in a temporary directory, for tests. Keep the directory alive while
    /// the database is used. Prefer [`Store::temporary`](super::Store::temporary).
    #[cfg(any(test, feature = "seed"))]
    pub fn temporary() -> Result<(tempfile::TempDir, Self)> {
        let dir = tempfile::tempdir()?;
        let database = Self::open(dir.path().join(DATABASE_FILE))?;
        Ok((dir, database))
    }

    /// Opens another connection to a database whose schema was already checked.
    // The one place the app opens SQLite; everything else goes through `Store`.
    #[allow(clippy::disallowed_methods)]
    pub(super) fn connect(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path).context("cannot open application database")?;
        connection.busy_timeout(BUSY_TIMEOUT)?;
        // Off by default on every new connection, and the schema's cascades rely on it.
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        // The UI and background work read and write concurrently.
        let _: String = connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        Ok(Self { connection })
    }
}

/// Creates the database file at `path` open to its owner only, before SQLite does, or makes
/// an existing one so. SQLite gives its `-wal` and `-shm` files the database's mode.
#[cfg(unix)]
pub(super) fn make_private(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt as _;

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn the_database_and_its_journal_are_private() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(DATABASE_FILE);
        let database = Database::open(&path)?;
        database.create_project("Physics")?;
        for file in [DATABASE_FILE, "study.sqlite3-wal", "study.sqlite3-shm"] {
            assert_eq!(mode(&dir.path().join(file)), 0o600, "{file}");
        }
        drop(database);

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644))?;
        Database::open(&path)?;
        assert_eq!(mode(&path), 0o600, "an existing database is fixed too");
        Ok(())
    }
}
