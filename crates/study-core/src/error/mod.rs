//! What kind of failure happened, so every layer can decide what to do without reading error
//! text: retry it, send the user to Settings, or explain that the file can't be read.
//!
//! To add a kind, add it to [`ErrorKind`] and decide [`ErrorKind::is_retryable`] (exhaustive).
//! Failed jobs store its code, so add it as a row of `codes_error_kind` too, as
//! `db::migrations` says (`check_lists_match_the_rust_enums` fails until then); the
//! desktop's exhaustive `Problem::of` then asks what to tell the user.

mod chain;

pub use chain::{Context, Error, Result};

use std::fmt;
use std::time::Duration;

crate::text_enum! {
    /// The meaning of a failure. Stored with failed jobs and mapped to copy by the UI.
    pub enum ErrorKind {
        /// The network or a service hiccuped; the same request may work later.
        Transient = "transient",
        /// A service is limiting requests; retry after it says to.
        RateLimited = "rate_limited",
        /// A service refused the credentials.
        Auth = "auth",
        /// A setting is missing or wrong, such as nobody signed in or a missing program.
        Config = "config",
        /// A local model is not installed or would not load.
        ModelUnavailable = "model_unavailable",
        /// Nothing here can read this kind of input.
        Unsupported = "unsupported",
        /// The input is damaged, empty, or too large.
        InvalidInput = "invalid_input",
        /// What the work was given holds too little to do it well, such as a session too
        /// thin to write flashcards on; a model said so rather than make something up.
        NotEnough = "not_enough",
        /// What the work was about no longer exists, such as a deleted file.
        NotFound = "not_found",
        /// Someone stopped the work.
        Cancelled = "cancelled",
        /// A bug or an unexpected failure.
        Internal = "internal",
    }
}

impl ErrorKind {
    /// Whether retrying the same work later, unchanged, may succeed.
    ///
    /// Exhaustive, so a new kind must decide here.
    pub const fn is_retryable(self) -> bool {
        match self {
            Self::Transient | Self::RateLimited => true,
            Self::Auth
            | Self::Config
            | Self::ModelUnavailable
            | Self::Unsupported
            | Self::InvalidInput
            | Self::NotEnough
            | Self::NotFound
            | Self::Cancelled
            | Self::Internal => false,
        }
    }

    /// Whether the work can succeed once the user sets something up, such as signing in,
    /// choosing a model or installing one; such work waits instead of failing.
    ///
    /// Exhaustive, so a new kind must decide here.
    pub const fn needs_setup(self) -> bool {
        match self {
            Self::Auth | Self::Config | Self::ModelUnavailable => true,
            Self::Transient
            | Self::RateLimited
            | Self::Unsupported
            | Self::InvalidInput
            | Self::NotEnough
            | Self::NotFound
            | Self::Cancelled
            | Self::Internal => false,
        }
    }
}

/// An error that knows what kind of failure it is.
pub trait Classify {
    /// What kind of failure this is.
    fn kind(&self) -> ErrorKind;

    /// How long the service asked to wait before retrying, when it said.
    fn retry_after(&self) -> Option<Duration> {
        None
    }
}

impl Classify for std::io::Error {
    fn kind(&self) -> ErrorKind {
        use std::io::ErrorKind as Io;
        match std::io::Error::kind(self) {
            Io::NotFound => ErrorKind::NotFound,
            Io::InvalidData | Io::InvalidInput | Io::UnexpectedEof => ErrorKind::InvalidInput,
            Io::TimedOut | Io::Interrupted | Io::ConnectionReset | Io::ConnectionAborted => {
                ErrorKind::Transient
            }
            Io::PermissionDenied => ErrorKind::Config,
            _ => ErrorKind::Internal,
        }
    }
}

/// A classified failure with its full message, as it crosses a boundary that doesn't know
/// the original error type, such as an extractor or job handler reporting to the job engine.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Failure {
    /// What kind of failure it is, which decides retries and the copy the user sees.
    pub kind: ErrorKind,
    /// The error and its causes, for logs and for the details the UI can reveal.
    pub message: String,
    /// How long the service asked to wait before retrying, when it said.
    pub retry_after: Option<Duration>,
}

impl Failure {
    /// A failure of `kind` with no retry hint.
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after: None,
        }
    }

    /// This failure as an [`Error`] of the same kind, for a command that ran a processor
    /// directly rather than as a job. (`?` would make it [`ErrorKind::Internal`].) The retry
    /// hint is dropped: only the jobs engine schedules retries.
    pub fn into_error(self) -> Error {
        Error::new(self.kind, self.message)
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Failure {}

impl<E: Classify + std::error::Error> From<E> for Failure {
    fn from(error: E) -> Self {
        let mut message = error.to_string();
        let mut source = error.source();
        while let Some(cause) = source {
            let text = cause.to_string();
            // `#[error(transparent)]` and `{0}` wrappers repeat their source's message.
            if !message.ends_with(&text) {
                message.push_str(": ");
                message.push_str(&text);
            }
            source = cause.source();
        }
        Self {
            kind: error.kind(),
            retry_after: error.retry_after(),
            message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct Refused;

    impl fmt::Display for Refused {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("HTTP 401")
        }
    }

    impl std::error::Error for Refused {}

    impl Classify for Refused {
        fn kind(&self) -> ErrorKind {
            ErrorKind::Auth
        }
    }

    #[test]
    fn a_failure_keeps_the_kind_and_the_message() {
        let failure = Failure::from(Refused);
        assert_eq!(failure.kind, ErrorKind::Auth);
        assert_eq!(failure.to_string(), "HTTP 401");
    }

    #[test]
    fn only_transient_kinds_are_retried() {
        let retried: Vec<_> = ErrorKind::ALL
            .iter()
            .filter(|kind| kind.is_retryable())
            .collect();
        assert_eq!(retried, [&ErrorKind::Transient, &ErrorKind::RateLimited]);
    }

    #[test]
    fn kinds_round_trip_through_their_codes() {
        for kind in ErrorKind::ALL {
            assert_eq!(kind.code().parse::<ErrorKind>(), Ok(*kind));
            let json = serde_json::to_string(kind).unwrap();
            assert_eq!(serde_json::from_str::<ErrorKind>(&json).unwrap(), *kind);
        }
    }
}
