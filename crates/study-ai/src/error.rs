//! [`Error`]: the failures any provider can have, and what kind each one is.

use std::time::Duration;

use study_core::{Classify, ErrorKind};

/// A result whose error is a provider's [`Error`] unless it says otherwise.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// A failure any provider can have. Feature crates wrap it next to their own input errors.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("cannot prepare the local model: {0}")]
    Model(String),
    #[error("{provider} failed: {message}")]
    Provider {
        provider: &'static str,
        message: String,
    },
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("update failed: {0}")]
    Update(#[from] cargo_packager_updater::Error),
    #[error("the provider has shut down")]
    Shutdown,
    /// Another caller's failure on the identical request, which can't be cloned: its text,
    /// and its kind so this caller is retried (or not) the same way.
    #[error("{message}")]
    Shared {
        message: String,
        kind: ErrorKind,
        retry_after: Option<Duration>,
    },
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Model(_) => ErrorKind::ModelUnavailable,
            Self::Provider { .. } => ErrorKind::Internal,
            Self::Http(error) => kind_of_http(error),
            Self::Io(error) => Classify::kind(error),
            Self::Update(error) => crate::updates::error_kind(error),
            Self::Shutdown => ErrorKind::Cancelled,
            Self::Shared { kind, .. } => *kind,
        }
    }

    fn retry_after(&self) -> Option<Duration> {
        match self {
            Self::Shared { retry_after, .. } => *retry_after,
            _ => None,
        }
    }
}

/// What a failed HTTP request means: its status when the server answered with an error,
/// else a transport failure (a timeout, a refused or dropped connection) that may pass. The
/// one place `reqwest` errors are mapped.
pub(crate) fn kind_of_http(error: &reqwest::Error) -> ErrorKind {
    if let Some(status) = error.status() {
        kind_of_status(status.as_u16())
    } else if error.is_timeout() || error.is_connect() || error.is_request() || error.is_body() {
        ErrorKind::Transient
    } else {
        ErrorKind::Internal
    }
}

/// What an HTTP error status from a provider means. The one place statuses are mapped.
pub(crate) fn kind_of_status(status: u16) -> ErrorKind {
    match status {
        401 | 403 => ErrorKind::Auth,
        429 => ErrorKind::RateLimited,
        408 | 500.. => ErrorKind::Transient,
        // A model or endpoint the provider doesn't have: a setting to fix.
        404 => ErrorKind::Config,
        400 | 413 | 415 | 422 => ErrorKind::InvalidInput,
        _ => ErrorKind::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_statuses_map_to_what_the_user_can_do() {
        assert_eq!(kind_of_status(401), ErrorKind::Auth);
        assert_eq!(kind_of_status(429), ErrorKind::RateLimited);
        assert_eq!(kind_of_status(503), ErrorKind::Transient);
        assert_eq!(kind_of_status(404), ErrorKind::Config);
        assert_eq!(kind_of_status(413), ErrorKind::InvalidInput);
        // Only timeouts, rate limits and server errors are retried.
        for status in [408, 429, 500, 503] {
            assert!(kind_of_status(status).is_retryable(), "{status}");
        }
        for status in [400, 401, 404, 413] {
            assert!(!kind_of_status(status).is_retryable(), "{status}");
        }
    }
}
