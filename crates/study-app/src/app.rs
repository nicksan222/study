//! [`App`] itself: opening the database, the runtime background work runs on, and the bus.
//! Starting that work, the handler for each job kind, and queueing, deleting, stopping and
//! catching up on jobs is in [`workers`].

mod workers;

use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};

use study_core::bus::EventBus;
use study_core::db::{Database, Store};
use study_core::{Context, Result, err};
use tokio::runtime::{Handle, Runtime};
use tokio::task::JoinHandle;

use study_pipeline::EmbedderSlot;
pub use workers::WorkerSetup;
use workers::Workers;

/// The running app. Clones share everything; background work stops with the last clone.
#[derive(Clone)]
pub struct App {
    inner: Arc<Inner>,
}

struct Inner {
    /// Why the database could not be opened, reported by every call that needs it.
    store: Result<Store, Arc<study_core::Error>>,
    bus: EventBus,
    /// Taken only to shut it down when the app is dropped; [`handle`](Self::handle) runs work.
    runtime: Option<Runtime>,
    handle: Handle,
    /// The local search model, shared by indexing and searching.
    embedder: EmbedderSlot,
    workers: Mutex<Option<Workers>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        // Stop the workers before the runtime they run on: its tasks may outlive the last
        // clone of the engine, and none of them may claim work once this app is gone.
        if let Some(workers) = self
            .workers
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            workers.jobs.stop();
        }
        if let Some(runtime) = self.runtime.take() {
            // Safe from any thread; interrupted jobs are queued again by the next start.
            runtime.shutdown_background();
        }
    }
}

impl App {
    /// Opens the application database in the platform's data directory. Fails only when the
    /// background runtime cannot start; a database that cannot be opened is reported by every
    /// call that needs it.
    pub fn open_default() -> Result<Self> {
        Self::with_store(Store::open_default())
    }

    /// Opens the database at `path`, creating it if needed. Fails as
    /// [`open_default`](Self::open_default) does.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::with_store(Store::open(path.as_ref()))
    }

    fn with_store(store: Result<Store>) -> Result<Self> {
        if let Err(error) = &store {
            tracing::error!(error = format!("{error:#}"), "cannot open the database");
        }
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name("study")
            .enable_all()
            .build()
            .context("cannot start the background runtime")?;
        Ok(Self {
            inner: Arc::new(Inner {
                store: store.map_err(Arc::new),
                bus: EventBus::new(),
                handle: runtime.handle().clone(),
                runtime: Some(runtime),
                embedder: EmbedderSlot::default(),
                workers: Mutex::new(None),
            }),
        })
    }

    pub(crate) fn store(&self) -> Result<&Store> {
        self.inner
            .store
            .as_ref()
            .map_err(|error| err!("the database is unavailable: {error:#}"))
    }

    /// Runs blocking database work on a pooled connection.
    pub(crate) fn with<T>(&self, work: impl FnOnce(&Database) -> Result<T>) -> Result<T> {
        self.store()?.with(work)
    }

    /// Runs blocking `work` with a clone of the app off the async executor, for async
    /// commands that touch the database.
    pub(crate) async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&App) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let app = self.clone();
        tokio::task::spawn_blocking(move || work(&app)).await?
    }

    /// Where background events are announced.
    pub fn bus(&self) -> &EventBus {
        &self.inner.bus
    }

    pub(crate) fn embedder(&self) -> &EmbedderSlot {
        &self.inner.embedder
    }

    /// Runs `future` on the app's runtime, which drives network clients and timers the UI's
    /// executor cannot. Awaiting the handle from the UI is fine.
    pub fn spawn<T: Send + 'static>(
        &self,
        future: impl Future<Output = T> + Send + 'static,
    ) -> JoinHandle<T> {
        self.inner.handle.spawn(future)
    }
}
