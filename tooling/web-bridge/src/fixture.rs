//! Fixture setup is the only direct database access: every browser operation uses gRPC.
use crate::{
    dispatch::Client,
    staging::{StagedFile, Staging},
};
use std::{path::Path, sync::Arc};
use study_app::{App, rpc::Embedded};
use study_core::db::Database;
use study_rpc::tonic::Status;
use tempfile::TempDir;

pub struct Session {
    pub client: Client,
    // Server precedes directory so shutdown is requested before temporary data is removed.
    server: tokio::sync::Mutex<Option<Embedded>>,
    directory: tokio::sync::Mutex<Option<TempDir>>,
    pub files: tokio::sync::Mutex<Option<Staging>>,
    // Network reads are cancellable, while accepted RPC file leases still drain normally.
    closed: tokio::sync::watch::Sender<bool>,
    upload_commit: std::sync::Mutex<()>,
}

impl Session {
    pub async fn fixture(root: &Path, seed: bool) -> Result<Arc<Self>, Status> {
        let directory = tempfile::tempdir_in(root).map_err(internal)?;
        Self::open(
            directory.path().join("study.sqlite3"),
            seed,
            true,
            Some(directory),
        )
        .await
    }

    /// Revocation is synchronous and precedes any wait for RPC or staging leases.
    pub fn begin_close(&self) {
        let _commit = self
            .upload_commit
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.closed.send_replace(true);
    }

    pub async fn cancelled(&self) {
        let mut closed = self.closed.subscribe();
        let _ = closed.wait_for(|value| *value).await;
    }

    /// Serialize registration with revocation: a cancelled batch can never commit later.
    pub fn commit_upload(
        &self,
        arena: &mut Staging,
        batch: Vec<StagedFile>,
    ) -> Result<Vec<String>, Status> {
        let _commit = self
            .upload_commit
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if *self.closed.borrow() {
            return Err(Status::cancelled("fixture session is closing"));
        }
        Ok(arena.commit(batch))
    }

    pub async fn close(&self) -> Result<(), Status> {
        self.begin_close();
        let stopped = if let Some(server) = self.server.lock().await.take() {
            server.shutdown().await.map_err(internal)
        } else {
            Ok(())
        };
        // Upload cancellation drops its uncommitted batch and mutex guard. Existing real
        // RPC reads retain their lease until the backend's admitted effects drain above.
        if let Some(uploads) = self.files.lock().await.take() {
            drop(uploads);
        }
        if let Some(directory) = self.directory.lock().await.take() {
            directory.close().map_err(internal)?;
        }
        stopped
    }

    pub async fn persistent(path: &Path) -> Result<Arc<Self>, Status> {
        Self::open(path.to_path_buf(), false, false, None).await
    }

    async fn open(
        path: std::path::PathBuf,
        seed: bool,
        test: bool,
        directory: Option<TempDir>,
    ) -> Result<Arc<Self>, Status> {
        let app = tokio::task::spawn_blocking(move || {
            let db = Database::open(&path).map_err(internal)?;
            if seed {
                study_seed::showcase(&db).map_err(internal)?;
            }
            drop(db);
            App::open(&path).map_err(internal)
        })
        .await
        .map_err(internal)??;
        let server = Embedded::start(app, test).await.map_err(internal)?;
        let mut client = server.client().await.map_err(internal)?;
        if !test {
            client.start_workers(study_rpc::v1::Empty {}).await?;
        }
        Ok(Arc::new(Self {
            client,
            server: tokio::sync::Mutex::new(Some(server)),
            directory: tokio::sync::Mutex::new(directory),
            files: tokio::sync::Mutex::new(Some(Staging::new()?)),
            closed: tokio::sync::watch::channel(false).0,
            upload_commit: std::sync::Mutex::new(()),
        }))
    }
}

fn internal(error: impl std::fmt::Display) -> Status {
    tracing::error!(%error, "cannot initialize RPC fixture");
    Status::internal("cannot initialize RPC fixture")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn revocation_rejects_late_upload_commit_and_keeps_existing_file_lease() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::fixture(root.path(), false).await.unwrap();
        let mut files = session.files.lock().await;
        let arena = files.as_mut().unwrap();
        let mut batch = Vec::new();
        arena
            .stage(&mut batch, "late.txt", b"never registered")
            .await
            .unwrap();
        session.begin_close();
        assert_eq!(
            session.commit_upload(arena, batch).unwrap_err().code(),
            study_rpc::tonic::Code::Cancelled
        );
        let closing = session.close();
        tokio::pin!(closing);
        // Cancellation is not a license to remove files protected by admitted RPC leases.
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut closing)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        drop(files);
        closing.await.unwrap();
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
}
