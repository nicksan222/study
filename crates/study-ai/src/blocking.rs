//! [`blocking`]: CPU-bound work moved off the async runtime, with a crash reported as a
//! provider failure instead of a panic.

use crate::Error;

/// Runs `work` on Tokio's blocking pool. If it panics, the caller gets a failure of
/// `provider` rather than the panic.
pub(crate) async fn blocking<T, E>(
    provider: &'static str,
    work: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, E>
where
    T: Send + 'static,
    E: From<Error> + Send + 'static,
{
    tokio::task::spawn_blocking(work).await.map_err(|error| {
        E::from(Error::Provider {
            provider,
            message: format!("stopped unexpectedly: {error}"),
        })
    })?
}
