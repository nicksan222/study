//! Claiming queued work, running handlers, and recording their outcomes.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Weak};
use std::time::Duration;

use tracing::Instrument as _;

use crate::db::{Job, NewJob, unix_timestamp as now};
use crate::{ErrorKind, Failure, JobId, JobStatus, Result};

use super::{Inner, Lane, lock};

/// Attempts a retryable failure gets in all, the first included.
const MAX_ATTEMPTS: u32 = 4;
/// The first retry waits this long; each later one twice as long as the one before.
pub(super) const FIRST_RETRY: Duration = Duration::from_secs(5);
/// The longest wait between attempts, whatever the service asks.
pub(super) const LONGEST_RETRY: Duration = Duration::from_secs(600);
/// How long an idle lane sleeps before looking again when nothing woke it.
const IDLE: Duration = Duration::from_secs(60);
/// How long a lane waits before claiming again after the database refused a claim.
const CLAIM_RETRY: Duration = Duration::from_secs(1);
/// Pauses between attempts to record a job's outcome.
const RECORD_RETRIES: [Duration; 4] = [
    Duration::from_millis(100),
    Duration::from_secs(1),
    Duration::from_secs(5),
    Duration::from_secs(30),
];

impl Inner {
    /// Runs one claimed job to its end and records the outcome.
    async fn execute(self: Arc<Self>, job: Job) {
        let id = job.id;
        let attempts = job.attempts;
        let span = tracing::info_span!("job", id = id.get(), kind = %job.kind);
        self.announce(id).await;
        let Some(handler) = self.handlers.get(&job.kind).cloned() else {
            let failure = Failure::new(
                ErrorKind::Internal,
                format!("nothing is registered to do {} jobs", job.kind),
            );
            self.finish(id, attempts, Err(failure)).await;
            return;
        };
        // A task of its own turns a panicking handler into a failed job, and lets
        // cancelling stop it.
        let task = tokio::spawn(async move { handler.run(job).await }.instrument(span));
        lock(&self.running).insert(id, task.abort_handle());
        // Cancelled between being claimed and being registered: nothing could abort it then.
        let still_running = self
            .store
            .run(move |database| Ok(database.job(id)?.map(|job| job.status)))
            .await;
        // Gone or no longer running stops it; a failed look proves nothing, so it runs on.
        if matches!(still_running, Ok(status) if status != Some(JobStatus::Running)) {
            task.abort();
        }
        let outcome = task.await;
        lock(&self.running).remove(&id);
        match outcome {
            Ok(result) => self.finish(id, attempts, result).await,
            // Cancelled: the database already says so.
            Err(error) if error.is_cancelled() => {}
            Err(error) => {
                let failure = Failure::new(
                    ErrorKind::Internal,
                    format!("the job stopped unexpectedly: {error}"),
                );
                self.finish(id, attempts, Err(failure)).await;
            }
        }
    }

    async fn finish(
        self: &Arc<Self>,
        id: JobId,
        attempts: u32,
        result: Result<Vec<NewJob>, Failure>,
    ) {
        if let Err(failure) = &result
            && !failure.kind.is_retryable()
        {
            tracing::warn!(job_id = id.get(), error = %failure, "job failed");
        }
        // Recording the outcome is retried a few times: a job left `running` would wait for
        // the next start of the app.
        for pause in RECORD_RETRIES {
            let result = result.clone();
            let recorded = self
                .store
                .run(move |database| match result {
                    Ok(followups) => database.succeed_job(id, &followups),
                    Err(failure) => {
                        let retry_at = (failure.kind.is_retryable() && attempts < MAX_ATTEMPTS)
                            .then(|| {
                                now() + retry_delay(attempts, failure.retry_after).as_secs() as i64
                            });
                        database.fail_job(id, &failure, retry_at)
                    }
                })
                .await;
            match recorded {
                Ok(_) => break,
                Err(error) => {
                    tracing::error!(
                        job_id = id.get(),
                        error = format!("{error:#}"),
                        "cannot record a job"
                    );
                    tokio::time::sleep(pause).await;
                }
            }
        }
        self.announce(id).await;
        // Follow-ups and released jobs may belong to any lane.
        self.wake_all();
    }
}

/// Claims and runs one lane's jobs until the engine stops.
pub(super) async fn run_lane(inner: Weak<Inner>, lane: Lane) {
    loop {
        let Some(this) = inner.upgrade() else {
            return;
        };
        if this.stopped.load(Ordering::SeqCst) {
            return;
        }
        let state = &this.lanes[&lane];
        let Ok(slot) = state.slots.clone().acquire_owned().await else {
            return;
        };
        let (kinds, stopped) = (state.kinds.clone(), this.stopped.clone());
        // Asked again under the write lock: a claim that waited for it past a stop, as the
        // next start queued work, must not take that work.
        let claimed = this
            .store
            .run(move |database| {
                database.claim_job_unless(&kinds, || stopped.load(Ordering::SeqCst))
            })
            .await;
        match claimed {
            Ok(Some(job)) => {
                let running = this.clone();
                tokio::spawn(async move {
                    running.execute(job).await;
                    drop(slot);
                });
            }
            Ok(None) => {
                drop(slot);
                let next_retry = this
                    .store
                    .run(|database| database.next_job_retry())
                    .await
                    .ok()
                    .flatten();
                // A second more, as `run_after` is in whole seconds and due only once reached.
                let wait = next_retry
                    .map(|at| Duration::from_secs(u64::try_from(at - now()).unwrap_or(0) + 1))
                    .unwrap_or(IDLE)
                    .min(IDLE);
                // Waits without the engine, so dropping its last clone stops the lane.
                let wake = state.wake.clone();
                drop(this);
                tokio::select! {
                    () = wake.notified() => {}
                    () = tokio::time::sleep(wait) => {}
                }
            }
            Err(error) => {
                drop(slot);
                tracing::error!(error = format!("{error:#}"), "cannot claim a job");
                drop(this);
                tokio::time::sleep(CLAIM_RETRY).await;
            }
        }
    }
}

/// How long to wait before the next attempt, after `attempts` so far.
pub(super) fn retry_delay(attempts: u32, asked: Option<Duration>) -> Duration {
    let backoff = FIRST_RETRY * 2u32.saturating_pow(attempts.saturating_sub(1));
    backoff.max(asked.unwrap_or_default()).min(LONGEST_RETRY)
}
