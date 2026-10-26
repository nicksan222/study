//! What can go wrong transcribing: the recording, or the provider.

use study_core::{Classify, ErrorKind};

/// A result whose error is a transcription [`Error`] unless it says otherwise.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Why a recording could not be transcribed.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The recording could not be read.
    #[error(transparent)]
    Media(#[from] study_media::Error),
    /// The provider failed: a model that would not load, an API error, the network.
    #[error(transparent)]
    Provider(#[from] crate::Error),
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Media(error) => error.kind(),
            Self::Provider(error) => error.kind(),
        }
    }
}
