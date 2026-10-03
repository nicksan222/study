//! Shared access to the database: a small pool of connections to one file whose schema was
//! checked once, when the store opened.

use super::Database;
use crate::{Context as _, Result};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// Idle connections kept for reuse; more are opened while work is busy and closed after.
const MAX_IDLE: usize = 4;

/// The database, shared by every part of the app. Clones share one pool.
#[derive(Clone)]
pub struct Store {
    inner: Arc<Inner>,
}

struct Inner {
    path: PathBuf,
    idle: Mutex<Vec<Database>>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("path", &self.inner.path)
            .finish()
    }
}

impl Store {
    /// Opens the database at `path`, creating or checking its schema.
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let first = Database::open(&path)?;
        Ok(Self {
            inner: Arc::new(Inner {
                path,
                idle: Mutex::new(vec![first]),
            }),
        })
    }

    /// Opens the application database in the platform's data directory, creating it there
    /// on first launch.
    pub fn open_default() -> Result<Self> {
        Self::open(Database::default_path()?)
    }

    /// A fresh store in a temporary directory, for tests. Keep the directory alive while the
    /// store is used.
    #[cfg(any(test, feature = "testing"))]
    pub fn temporary() -> Result<(tempfile::TempDir, Self)> {
        let dir = tempfile::tempdir()?;
        let store = Self::open(dir.path().join(super::open::DATABASE_FILE))?;
        Ok((dir, store))
    }

    /// The database file.
    pub fn path(&self) -> &Path {
        &self.inner.path
    }

    /// Runs blocking database `work` on a pooled connection. Call it off the UI thread and
    /// outside async code, or use [`run`](Self::run).
    pub fn with<T>(&self, work: impl FnOnce(&Database) -> Result<T>) -> Result<T> {
        let database = self.take()?;
        let result = work(&database);
        self.give(database);
        result
    }

    /// Runs blocking database `work` on Tokio's blocking pool.
    pub async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Database) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || store.with(work))
            .await
            .context("database work stopped unexpectedly")?
    }

    fn take(&self) -> Result<Database> {
        let idle = self.idle().pop();
        idle.map_or_else(|| Database::connect(&self.inner.path), Ok)
    }

    fn give(&self, database: Database) {
        let mut idle = self.idle();
        if idle.len() < MAX_IDLE {
            idle.push(database);
        }
    }

    /// The idle connections, carrying on after a panic elsewhere: a pooled connection is
    /// whole either way.
    fn idle(&self) -> MutexGuard<'_, Vec<Database>> {
        self.inner
            .idle
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connections_are_shared_and_see_each_others_writes() -> Result<()> {
        let (_dir, store) = Store::temporary()?;
        let project = store.with(|database| database.create_project("Biology"))?;
        let other = store.clone();
        let names = std::thread::spawn(move || {
            other.with(|database| {
                // A second connection, opened while the first is busy elsewhere.
                store.with(|_| Ok(()))?;
                database.list_projects()
            })
        })
        .join()
        .expect("thread")?;
        assert_eq!(names, [project]);
        Ok(())
    }

    #[test]
    fn opening_a_missing_directory_fails_immediately() {
        assert!(Store::open("/nonexistent-dir/study.sqlite3").is_err());
    }
}
