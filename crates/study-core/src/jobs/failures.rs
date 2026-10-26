//! What every [`JobHandler`](super::JobHandler) shares: rejecting a job aimed at the wrong
//! target and running blocking work (a model, a search) off the async workers. The app's own
//! errors become classified [`Failure`]s with `?` (see `From<Error> for Failure`).

use crate::db::Job;
use crate::{ErrorKind, Failure};

/// The failure for a job whose target is not what its handler works on: a bug.
pub fn wrong_target(job: &Job) -> Failure {
    Failure::new(
        ErrorKind::Internal,
        format!("a {:?} job cannot work on {:?}", job.kind, job.target),
    )
}

/// Runs blocking `work` on the runtime's blocking pool. The error is `work` panicking; what
/// `work` itself returns is the caller's to classify.
pub async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Failure> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| crate::Error::from(error).into())
}
