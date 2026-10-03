//! [`Jobs`]: the engine's handle and the state its lanes share. `worker` claims queued
//! jobs, runs their handlers, and records outcomes with retry backoff.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use futures::future::BoxFuture;
use tokio::runtime::Handle;
use tokio::sync::{Notify, Semaphore};
use tokio::task::AbortHandle;

use crate::bus::EventBus;
use crate::db::{Job, JobEvent, NewJob, Store};
use crate::{Context as _, Failure, JobId, JobKind, JobStatus, Result};

#[cfg(test)]
mod tests;
mod worker;

use worker::run_lane;

/// How much of one kind of work may run at once.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Lane {
    /// Reading sources. Their models bound their own work (one shared pool of the local
    /// speech model, pages in batches), so two reads run at once and a long recording never
    /// holds up every other file; more would hold too much decoded audio at once.
    Reading,
    /// Quick database and CPU work, such as indexing.
    Light,
    /// Language model calls.
    Llm,
}

impl Lane {
    fn slots(self) -> usize {
        match self {
            Self::Light => 1,
            Self::Reading | Self::Llm => 2,
        }
    }
}

/// Does one kind of job.
pub trait JobHandler: Send + Sync + 'static {
    /// The one kind of job this handler does.
    fn kind(&self) -> JobKind;

    /// Where its jobs wait for a slot.
    fn lane(&self) -> Lane;

    /// Does the job, returning the jobs that follow from it. Every failure is classified: a
    /// retryable one is tried again later, anything else ends the job.
    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>>;
}

/// The running engine. Clones share it; its work stops with the last clone.
#[derive(Clone)]
pub struct Jobs {
    inner: Arc<Inner>,
}

struct Inner {
    store: Store,
    bus: EventBus,
    runtime: Handle,
    handlers: HashMap<JobKind, Arc<dyn JobHandler>>,
    lanes: HashMap<Lane, LaneState>,
    /// Handler tasks of running jobs, so cancelling one stops it.
    running: Mutex<HashMap<JobId, AbortHandle>>,
    /// The lane loops and anything spawned beside them.
    tasks: Mutex<Vec<AbortHandle>>,
    /// Set by [`Jobs::stop`]; shared with the claims in flight, which then claim nothing.
    stopped: Arc<AtomicBool>,
}

struct LaneState {
    kinds: Vec<JobKind>,
    slots: Arc<Semaphore>,
    /// Shared, so an idle lane waits on it without keeping the engine alive.
    wake: Arc<Notify>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.stop();
    }
}

impl Jobs {
    /// Starts running jobs on `runtime` through `handlers`, one per kind. Jobs a previous run
    /// left running are queued again first.
    pub fn start(
        store: Store,
        handlers: Vec<Arc<dyn JobHandler>>,
        bus: EventBus,
        runtime: Handle,
    ) -> Result<Self> {
        store
            .with(|database| database.requeue_interrupted_jobs())
            .context("cannot resume interrupted jobs")?;
        let mut lanes: HashMap<Lane, LaneState> = HashMap::new();
        let mut by_kind = HashMap::new();
        for handler in handlers {
            let lane = lanes.entry(handler.lane()).or_insert_with(|| LaneState {
                kinds: Vec::new(),
                slots: Arc::new(Semaphore::new(handler.lane().slots())),
                wake: Arc::default(),
            });
            lane.kinds.push(handler.kind());
            by_kind.insert(handler.kind(), handler);
        }
        let jobs = Self {
            inner: Arc::new(Inner {
                store,
                bus,
                runtime,
                handlers: by_kind,
                lanes,
                running: Mutex::default(),
                tasks: Mutex::default(),
                stopped: Arc::default(),
            }),
        };
        let lanes: Vec<Lane> = jobs.inner.lanes.keys().copied().collect();
        for lane in lanes {
            let weak = Arc::downgrade(&jobs.inner);
            jobs.spawn(async move { run_lane(weak, lane).await });
        }
        Ok(jobs)
    }

    /// The database the jobs live in.
    pub fn store(&self) -> &Store {
        &self.inner.store
    }

    /// Where job changes are announced.
    pub fn bus(&self) -> &EventBus {
        &self.inner.bus
    }

    /// Runs `work` beside the jobs until the engine stops.
    pub fn spawn(&self, work: impl Future<Output = ()> + Send + 'static) {
        let task = self.inner.runtime.spawn(work);
        lock(&self.inner.tasks).push(task.abort_handle());
    }

    /// Looks for queued work now, such as after jobs were queued in a caller's transaction.
    pub fn wake(&self) {
        self.inner.wake_all();
    }

    /// Stops the tasks of jobs that ended in a caller's transaction: deleted with their
    /// subject (a source, a session, study material), or cancelled, such as the reads of a
    /// document the user corrected. Wakes the lanes, since jobs that waited on them are free
    /// now. Call after such a change. Blocks on the database.
    pub fn stop_ended(&self) -> Result<()> {
        let running: Vec<JobId> = lock(&self.inner.running).keys().copied().collect();
        for id in running {
            let status = self
                .inner
                .store
                .with(|database| database.job(id))?
                .map(|job| job.status);
            if status != Some(JobStatus::Running) {
                self.inner.abort(id);
            }
        }
        self.wake();
        Ok(())
    }

    /// Queues one job and wakes whoever runs it. Blocks on the database.
    pub fn enqueue(&self, job: &NewJob) -> Result<JobId> {
        let id = self
            .inner
            .store
            .with(|database| database.enqueue_job(job))?;
        self.inner.changed(id);
        Ok(id)
    }

    /// Queues one job unless the same work has not ended yet, running included, and wakes
    /// whoever runs it; returns the job doing the work. Blocks on the database.
    pub fn enqueue_once(&self, job: &NewJob) -> Result<JobId> {
        let id = self
            .inner
            .store
            .with(|database| database.enqueue_job_once(job))?;
        self.inner.changed(id);
        Ok(id)
    }

    /// Stops a job that has not ended. Returns `false` when it had. Blocks on the database.
    pub fn cancel(&self, id: JobId) -> Result<bool> {
        let cancelled = self.inner.store.with(|database| database.cancel_job(id))?;
        if cancelled {
            self.inner.abort(id);
            // Jobs waiting on it may run now.
            self.inner.changed(id);
        }
        Ok(cancelled)
    }

    /// Stops the engine for good: its lanes and running handlers end, and no job is claimed
    /// any more, not even by a claim already waiting for the database. Call it before
    /// dropping the runtime it runs on, as tasks in flight may outlive the last clone. Jobs
    /// it interrupts stay running until the next start queues them again.
    pub fn stop(&self) {
        self.inner.stop();
    }

    /// Queues a failed or cancelled job again. Returns `false` when it is neither. Blocks on
    /// the database.
    pub fn retry(&self, id: JobId) -> Result<bool> {
        let queued = self.inner.store.with(|database| database.retry_job(id))?;
        if queued {
            self.inner.changed(id);
        }
        Ok(queued)
    }
}

impl Inner {
    fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        // Interrupted jobs are queued again by the next start.
        for task in lock(&self.tasks).drain(..) {
            task.abort();
        }
        for (_, task) in lock(&self.running).drain() {
            task.abort();
        }
    }

    /// Stops the handler task of a running job, if it has one.
    fn abort(&self, id: JobId) {
        if let Some(task) = lock(&self.running).remove(&id) {
            task.abort();
        }
    }

    /// Announces a job the caller just changed in the database, and wakes the lanes, since
    /// it or jobs waiting on it may run now. Blocks on the database.
    fn changed(&self, id: JobId) {
        self.announce_blocking(id);
        self.wake_all();
    }

    fn wake_all(&self) {
        for lane in self.lanes.values() {
            // Stores a wakeup for a lane that is not waiting yet, so none is missed.
            lane.wake.notify_one();
        }
    }

    /// Announces a job's current status. The database is the truth, so a failure to read it
    /// only costs an event; listeners reload anyway.
    fn announce_blocking(&self, id: JobId) {
        let found = self.store.with(|database| {
            let Some(job) = database.job(id)? else {
                return Ok(None);
            };
            Ok(Some((job, database.job_scope(id)?)))
        });
        match found {
            Ok(Some((job, scope))) => {
                self.bus.publish(JobEvent::Changed {
                    job_id: id,
                    kind: job.kind,
                    status: job.status,
                    source_id: scope.source_id,
                    session_id: scope.session_id,
                });
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(
                job_id = id.get(),
                error = format!("{error:#}"),
                "cannot announce a job"
            ),
        }
    }

    async fn announce(self: &Arc<Self>, id: JobId) {
        let this = self.clone();
        let _ = tokio::task::spawn_blocking(move || this.announce_blocking(id)).await;
    }
}

/// Locks `mutex`, carrying on after a panic elsewhere: the maps it guards stay consistent.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
