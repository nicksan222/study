//! Background jobs: what is running, and stopping or retrying one.

use study_core::Result;
use study_core::db::{Job, JobOverview};
use study_core::{ErrorKind, JobId, JobKind, Requirement};

use crate::App;

impl App {
    /// Queues work waiting for the requirement after its setup was committed, and wakes the
    /// workers only after those job changes commit.
    pub(crate) fn release_waiting(&self, requirement: Requirement) -> Result<()> {
        let released = self.with(|database| database.release_waiting(requirement))?;
        if released > 0 {
            self.wake();
        }
        Ok(())
    }

    /// The newest `limit` jobs with the file, session, and project each works on.
    pub fn job_overviews(&self, limit: usize) -> Result<Vec<JobOverview>> {
        self.with(|database| database.list_job_overviews(limit))
    }

    /// One job as it stands now, with why it failed when it did.
    pub fn job(&self, id: JobId) -> Result<Option<Job>> {
        self.with(|database| database.job(id))
    }

    /// Stops a job that has not ended. Returns `false` when it has.
    pub fn cancel_job(&self, id: JobId) -> Result<bool> {
        self.running()?.jobs.cancel(id)
    }

    /// Queues a failed or cancelled job again. Returns `false` when it is neither.
    pub fn retry_job(&self, id: JobId) -> Result<bool> {
        self.running()?.jobs.retry(id)
    }

    /// Queues again every job of `kinds` that failed with one of `errors`, each waiting for
    /// the work it needs, and wakes the workers when there was one.
    pub(crate) fn retry_failed(&self, kinds: &[JobKind], errors: &[ErrorKind]) -> Result<()> {
        let retried = self.with(|database| database.retry_failed_jobs(kinds, errors))?;
        if retried > 0 {
            self.wake();
        }
        Ok(())
    }
}
