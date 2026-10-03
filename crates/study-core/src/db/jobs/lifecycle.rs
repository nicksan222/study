//! Every change of a job's status: queued (or blocked), running, and how it ended.
//!
//! ```text
//! enqueue ─► blocked ─(dependencies end)─► queued ─claim─► running ─┬─► succeeded
//!                                            ▲ ▲                    ├─► failed
//!                                            │ └──── fail, retry_at ┤
//!                         release_waiting ── waiting ◄── fail, needs setup ┘
//! cancel:  blocked, queued, waiting or running ─► cancelled
//! retry:   failed or cancelled ─► queued, or blocked while dependencies run
//! ```
//!
//! A job that fails for want of something the user sets up
//! ([`ErrorKind::needs_setup`]) and needs it by its plan waits for it, without ending, so
//! what depends on it stays blocked; setting it up releases it.

use super::super::{Database, placeholders, unix_timestamp};
use super::{JOB_COLUMNS, Job, JobTarget, NOT_STARTED, NewJob, PENDING};
use crate::Result;
use crate::{ErrorKind, Failure, JobId, JobKind, JobStatus, Requirement};
use rusqlite::{Connection, OptionalExtension as _, params, params_from_iter};

/// Queues `job` using the caller's transaction and returns its id. The same work already
/// waiting is returned instead of queued twice.
pub(in crate::db) fn enqueue(connection: &Connection, job: &NewJob) -> Result<JobId> {
    let key = job.dedupe_key();
    let pending_deps = pending_among(connection, &job.after)?;
    let status = if pending_deps.is_empty() {
        JobStatus::Queued
    } else {
        JobStatus::Blocked
    };
    let (target_column, target_id) = job.target.column();
    let now = unix_timestamp();
    // `jobs_pending_dedupe_idx` is unique over waiting jobs only, so this inserts nothing
    // while the same work waits, and a new copy once the old one has started.
    let inserted = connection.execute(
        &format!(
            "INSERT OR IGNORE INTO jobs (kind, {target_column}, args, dedupe_key, status,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)"
        ),
        params![
            job.kind,
            target_id,
            job.args.as_ref().map(|args| args.to_string()),
            key,
            status,
            now
        ],
    )?;
    if inserted == 0 {
        // The waiting twin now also waits for what this caller needed first.
        let existing: JobId = connection.query_row(
            &format!("SELECT id FROM jobs WHERE dedupe_key = ?1 AND status IN {NOT_STARTED}"),
            params![key],
            |row| row.get(0),
        )?;
        add_dependencies(connection, existing, &pending_deps)?;
        if !pending_deps.is_empty() {
            connection.execute(
                "UPDATE jobs SET status = 'blocked', updated_at = ?2
                 WHERE id = ?1 AND status = 'queued'",
                params![existing, now],
            )?;
        }
        return Ok(existing);
    }
    let id = JobId::new(connection.last_insert_rowid());
    add_dependencies(connection, id, &pending_deps)?;
    Ok(id)
}

/// Cancels, in the caller's transaction, every job of `kind` on `target` that has not ended,
/// running included, and every one that failed, then frees the jobs that waited on them.
/// A failed one counts because a later sign-in or install would retry it on its own; after
/// this only the user asks for that work again. Returns how many it cancelled.
pub(in crate::db) fn cancel_unfinished(
    connection: &Connection,
    kind: JobKind,
    target: JobTarget,
) -> Result<usize> {
    let (target_column, target_id) = target.column();
    let now = unix_timestamp();
    let cancelled = connection.execute(
        &format!(
            "UPDATE jobs SET status = 'cancelled', waiting_for = NULL, finished_at = ?1,
                 updated_at = ?1
             WHERE kind = ?2 AND {target_column} = ?3
               AND (status IN {PENDING} OR status = 'failed')"
        ),
        params![now, kind, target_id],
    )?;
    if cancelled != 0 {
        release_blocked(connection)?;
    }
    Ok(cancelled)
}

/// Those of `jobs` that have not ended yet.
fn pending_among(connection: &Connection, jobs: &[JobId]) -> Result<Vec<JobId>> {
    if jobs.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(&format!(
        "SELECT id FROM jobs WHERE id IN ({}) AND status IN {PENDING}",
        placeholders(jobs.len())
    ))?;
    let pending = statement
        .query_map(params_from_iter(jobs), |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(pending)
}

/// Makes `job` wait for each of `dependencies`.
fn add_dependencies(connection: &Connection, job: JobId, dependencies: &[JobId]) -> Result<()> {
    for dependency in dependencies {
        connection.execute(
            "INSERT OR IGNORE INTO job_deps (job_id, depends_on) VALUES (?1, ?2)",
            params![job, dependency],
        )?;
    }
    Ok(())
}

/// Whether another job doing the same work already waits, so this one need not. It must
/// not wait too: the dedupe index allows one waiting job per key.
fn has_waiting_twin(connection: &Connection, id: JobId) -> Result<bool> {
    Ok(waiting_twin(connection, id)?.is_some())
}

/// Has what waited on `from` wait on `twin` instead, which does the same work and waits
/// itself, so ending `from` frees none of it early. Waiting work queued meanwhile waits again.
fn hand_dependents_to(connection: &Connection, from: JobId, twin: JobId) -> Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO job_deps (job_id, depends_on)
         SELECT job_id, ?1 FROM job_deps WHERE depends_on = ?2 AND job_id != ?1",
        params![twin, from],
    )?;
    connection.execute("DELETE FROM job_deps WHERE depends_on = ?1", params![from])?;
    connection.execute(
        "UPDATE jobs SET status = 'blocked'
         WHERE status = 'queued' AND id IN (SELECT job_id FROM job_deps WHERE depends_on = ?1)",
        params![twin],
    )?;
    Ok(())
}

/// The other job doing the same work as `id` that waits, if one does.
fn waiting_twin(connection: &Connection, id: JobId) -> Result<Option<JobId>> {
    let twin = connection
        .query_row(
            &format!(
                "SELECT other.id FROM jobs this JOIN jobs other
                     ON other.dedupe_key = this.dedupe_key AND other.id != this.id
                 WHERE this.id = ?1 AND other.status IN {NOT_STARTED}"
            ),
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(twin)
}

/// Queues blocked jobs whose dependencies have all ended or are gone, such as the read of a
/// source deleted before it was read.
fn release_blocked(connection: &Connection) -> Result<usize> {
    let released = connection.execute(
        &format!(
            "UPDATE jobs SET status = 'queued', updated_at = ?1
             WHERE status = 'blocked' AND NOT EXISTS (
                 SELECT 1 FROM job_deps dep JOIN jobs other ON other.id = dep.depends_on
                 WHERE dep.job_id = jobs.id AND other.status IN {PENDING})"
        ),
        params![unix_timestamp()],
    )?;
    Ok(released)
}

impl Database {
    /// Queues one job. The same work already waiting is returned instead.
    pub fn enqueue_job(&self, job: &NewJob) -> Result<JobId> {
        let tx = self.immediate()?;
        let id = enqueue(&tx, job)?;
        tx.commit()?;
        Ok(id)
    }

    /// Queues one job unless the same work has not ended yet, running included, and returns
    /// that job instead. For work asked for by hand, where asking twice means asking once.
    pub fn enqueue_job_once(&self, job: &NewJob) -> Result<JobId> {
        let tx = self.immediate()?;
        let pending = tx
            .query_row(
                &format!(
                    "SELECT id FROM jobs WHERE dedupe_key = ?1 AND status IN {PENDING}
                     ORDER BY id LIMIT 1"
                ),
                params![job.dedupe_key()],
                |row| row.get(0),
            )
            .optional()?;
        let id = match pending {
            Some(id) => id,
            None => enqueue(&tx, job)?,
        };
        tx.commit()?;
        Ok(id)
    }

    /// Marks the oldest queued job of one of `kinds` that is due as running, and returns it;
    /// for tests, which have no engine to stop.
    #[cfg(any(test, feature = "seed"))]
    pub fn claim_job(&self, kinds: &[JobKind]) -> Result<Option<Job>> {
        self.claim_job_unless(kinds, || false)
    }

    /// Marks the oldest queued job of one of `kinds` that is due as running, and returns it,
    /// for an engine that may stop meanwhile: `stopped` is asked once this holds the write
    /// lock, and claims nothing when it says so. A claim still waiting for the lock as its
    /// engine stops then never marks running a job that nothing will run, such as one queued
    /// by the next start, after it requeued what was left running.
    pub fn claim_job_unless(
        &self,
        kinds: &[JobKind],
        stopped: impl FnOnce() -> bool,
    ) -> Result<Option<Job>> {
        if kinds.is_empty() {
            return Ok(None);
        }
        let tx = self.immediate()?;
        if stopped() {
            return Ok(None);
        }
        let now = unix_timestamp();
        // Dependencies deleted with their subject never announce an end.
        release_blocked(&tx)?;
        let mut values: Vec<rusqlite::types::Value> = vec![now.into()];
        values.extend(kinds.iter().map(|kind| kind.code().to_owned().into()));
        let id: Option<JobId> = tx
            .query_row(
                &format!(
                    "SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ?1
                     AND kind IN ({}) ORDER BY id LIMIT 1",
                    placeholders(kinds.len())
                ),
                params_from_iter(values),
                |row| row.get(0),
            )
            .optional()?;
        let Some(id) = id else {
            return Ok(None);
        };
        tx.execute(
            "UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ?1,
                 finished_at = NULL, updated_at = ?1
             WHERE id = ?2",
            params![now, id],
        )?;
        let job = tx.query_row(
            &format!("SELECT {JOB_COLUMNS} FROM jobs j WHERE j.id = ?1"),
            params![id],
            Job::from_row,
        )?;
        tx.commit()?;
        Ok(Some(job))
    }

    /// Records that a running job succeeded and queues its follow-up work, in one
    /// transaction. Returns `false`, changing nothing, when it was no longer running (it was
    /// cancelled meanwhile).
    pub fn succeed_job(&self, id: JobId, followups: &[NewJob]) -> Result<bool> {
        let tx = self.immediate()?;
        let now = unix_timestamp();
        let changed = tx.execute(
            "UPDATE jobs SET status = 'succeeded', error_kind = NULL, error = NULL,
                 finished_at = ?1, updated_at = ?1
             WHERE id = ?2 AND status = 'running'",
            params![now, id],
        )?;
        if changed == 0 {
            return Ok(false);
        }
        for followup in followups {
            enqueue(&tx, followup)?;
        }
        release_blocked(&tx)?;
        tx.commit()?;
        Ok(true)
    }

    /// Records why a running job failed. With `retry_at`, it is queued again for then. When
    /// it failed for want of a setup its plan needs, it waits for that; otherwise it ends.
    /// Returns `false` when it was no longer running.
    pub fn fail_job(&self, id: JobId, failure: &Failure, retry_at: Option<i64>) -> Result<bool> {
        let tx = self.immediate()?;
        let now = unix_timestamp();
        // A twin not yet started will do the work; this attempt just ends, and what waited on
        // it waits on the twin.
        let twin = waiting_twin(&tx, id)?;
        let retry_at = retry_at.filter(|_| twin.is_none());
        let waits_for = match (retry_at, twin) {
            (None, None) if failure.kind.needs_setup() => self.needed_by(id)?,
            _ => None,
        };
        let changed = match (retry_at, waits_for) {
            (_, Some(requirement)) => tx.execute(
                "UPDATE jobs SET status = 'waiting', waiting_for = ?1, error_kind = ?2,
                     error = ?3, updated_at = ?4
                 WHERE id = ?5 AND status = 'running'",
                params![requirement, failure.kind, failure.message, now, id],
            )?,
            (Some(at), None) => tx.execute(
                "UPDATE jobs SET status = 'queued', run_after = ?1, error_kind = ?2, error = ?3,
                     finished_at = ?4, updated_at = ?4
                 WHERE id = ?5 AND status = 'running'",
                params![at, failure.kind, failure.message, now, id],
            )?,
            (None, None) => tx.execute(
                "UPDATE jobs SET status = 'failed', error_kind = ?1, error = ?2,
                     finished_at = ?3, updated_at = ?3
                 WHERE id = ?4 AND status = 'running'",
                params![failure.kind, failure.message, now, id],
            )?,
        };
        if changed != 0 {
            if let Some(twin) = twin {
                hand_dependents_to(&tx, id, twin)?;
            }
            release_blocked(&tx)?;
        }
        tx.commit()?;
        Ok(changed != 0)
    }

    /// What job `id` needs set up, by its plan now; `None` when it is gone.
    fn needed_by(&self, id: JobId) -> Result<Option<Requirement>> {
        let Some(job) = self.job(id)? else {
            return Ok(None);
        };
        crate::processing::requirement_of(self, &job)
    }

    /// Queues again, as if new, every job waiting for `requirement`, now that it is set up.
    /// Returns how many there were.
    pub fn release_waiting(&self, requirement: Requirement) -> Result<usize> {
        let tx = self.immediate()?;
        let released = tx.execute(
            &format!(
                "UPDATE jobs SET status = CASE WHEN EXISTS (
                     SELECT 1 FROM job_deps dep JOIN jobs other ON other.id = dep.depends_on
                     WHERE dep.job_id = jobs.id AND other.status IN {PENDING}
                 ) THEN 'blocked' ELSE 'queued' END,
                 waiting_for = NULL, attempts = 0, run_after = 0, error_kind = NULL,
                 error = NULL, updated_at = ?1
                 WHERE status = 'waiting' AND waiting_for = ?2"
            ),
            params![unix_timestamp(), requirement],
        )?;
        tx.commit()?;
        Ok(released)
    }

    /// Stops a job that has not ended. Whatever a running one still produces is discarded,
    /// since it is no longer running. Returns `false` when it had already ended.
    pub fn cancel_job(&self, id: JobId) -> Result<bool> {
        let tx = self.immediate()?;
        let now = unix_timestamp();
        let changed = tx.execute(
            &format!(
                "UPDATE jobs SET status = 'cancelled', waiting_for = NULL, finished_at = ?1,
                     updated_at = ?1
                 WHERE id = ?2 AND status IN {PENDING}"
            ),
            params![now, id],
        )?;
        if changed != 0 {
            release_blocked(&tx)?;
        }
        tx.commit()?;
        Ok(changed != 0)
    }

    /// Queues a failed or cancelled job again, now, as if new: it gets its automatic retries
    /// again. Returns `false` when it is neither failed nor cancelled, or when the same work
    /// already waits: that twin does it, and this job stays as it was.
    pub fn retry_job(&self, id: JobId) -> Result<bool> {
        let tx = self.immediate()?;
        if has_waiting_twin(&tx, id)? {
            return Ok(false);
        }
        // Work it waited for that is still under way keeps it waiting.
        let waits: bool = tx.query_row(
            &format!(
                "SELECT EXISTS (SELECT 1 FROM job_deps dep JOIN jobs other ON other.id = dep.depends_on
                 WHERE dep.job_id = ?1 AND other.status IN {PENDING})"
            ),
            params![id],
            |row| row.get(0),
        )?;
        let status = if waits {
            JobStatus::Blocked
        } else {
            JobStatus::Queued
        };
        let changed = tx.execute(
            "UPDATE jobs SET status = ?3, attempts = 0, run_after = 0, error_kind = NULL,
                 error = NULL, started_at = NULL, finished_at = NULL, updated_at = ?1
             WHERE id = ?2 AND status IN ('failed', 'cancelled')",
            params![unix_timestamp(), id, status],
        )?;
        tx.commit()?;
        Ok(changed != 0)
    }

    /// Starts again every job of `kinds` that failed with one of `errors`: for want of a
    /// model, such as reads attempted before the local model was installed, or of a setup the
    /// user has since finished, such as signing in. Returns how many there were.
    ///
    /// All in one transaction, and a job whose prerequisites are among those started again
    /// waits for them, whatever order they come in: a reply retried with the read it needs
    /// must not run before that read.
    pub fn retry_failed_jobs(&self, kinds: &[JobKind], errors: &[ErrorKind]) -> Result<usize> {
        if kinds.is_empty() || errors.is_empty() {
            return Ok(0);
        }
        let tx = self.immediate()?;
        let list = |values: Vec<String>| values.join(", ");
        let kinds = list(kinds.iter().map(|kind| format!("'{kind}'")).collect());
        let errors = list(errors.iter().map(|error| format!("'{error}'")).collect());
        let failed: Vec<JobId> = tx
            .prepare(&format!(
                "SELECT id FROM jobs WHERE status = 'failed'
                   AND kind IN ({kinds}) AND error_kind IN ({errors})
                 ORDER BY id DESC"
            ))?
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let now = unix_timestamp();
        let mut retried = Vec::new();
        // Newest first, so of several attempts at the same work only the latest runs.
        for id in failed {
            if let Some(twin) = waiting_twin(&tx, id)? {
                // An older attempt at work a newer one now does: it ends here, so no later
                // retry runs it again, and what waited on it waits on the twin instead.
                tx.execute(
                    "UPDATE jobs SET status = 'cancelled', finished_at = ?1, updated_at = ?1
                     WHERE id = ?2",
                    params![now, id],
                )?;
                hand_dependents_to(&tx, id, twin)?;
                continue;
            }
            tx.execute(
                "UPDATE jobs SET status = 'queued', attempts = 0, run_after = 0,
                     error_kind = NULL, error = NULL, started_at = NULL, finished_at = NULL,
                     updated_at = ?1
                 WHERE id = ?2",
                params![now, id],
            )?;
            retried.push(id);
        }
        // Now that all of them wait again, those whose prerequisites do wait for them.
        let mut block = tx.prepare(&format!(
            "UPDATE jobs SET status = 'blocked' WHERE id = ?1 AND EXISTS (
                 SELECT 1 FROM job_deps dep JOIN jobs other ON other.id = dep.depends_on
                 WHERE dep.job_id = ?1 AND other.status IN {PENDING})"
        ))?;
        for &id in &retried {
            block.execute(params![id])?;
        }
        drop(block);
        tx.commit()?;
        Ok(retried.len())
    }

    /// Queues again the jobs a previous run of the app left running; one whose twin already
    /// waits is cancelled instead, leaving the work to the twin. Call before the engine
    /// starts; returns how many there were.
    pub(crate) fn requeue_interrupted_jobs(&self) -> Result<usize> {
        let tx = self.immediate()?;
        let now = unix_timestamp();
        let running: Vec<JobId> = tx
            .prepare("SELECT id FROM jobs WHERE status = 'running' ORDER BY id")?
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        for &id in &running {
            let twin = waiting_twin(&tx, id)?;
            if let Some(twin) = twin {
                hand_dependents_to(&tx, id, twin)?;
            }
            let status = if twin.is_some() {
                JobStatus::Cancelled
            } else {
                JobStatus::Queued
            };
            tx.execute(
                "UPDATE jobs SET status = ?1, started_at = NULL, updated_at = ?2 WHERE id = ?3",
                params![status, now, id],
            )?;
        }
        release_blocked(&tx)?;
        tx.commit()?;
        Ok(running.len())
    }

    /// When the next queued job waiting for a retry is due, if any is.
    pub(crate) fn next_job_retry(&self) -> Result<Option<i64>> {
        let at = self.connection.query_row(
            "SELECT min(run_after) FROM jobs WHERE status = 'queued' AND run_after > ?1",
            params![unix_timestamp()],
            |row| row.get(0),
        )?;
        Ok(at)
    }
}
