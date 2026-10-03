//! What can go wrong reading a document: the file, the provider, or its model.

use study_core::{Classify, ErrorKind};

/// A result whose error is a page-reading [`Error`] unless it says otherwise.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Why a document's pages could not be read.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The document could not be read.
    #[error(transparent)]
    Media(#[from] study_media::Error),
    /// The provider failed: an API error, the network.
    #[error(transparent)]
    Provider(#[from] crate::Error),
    /// The language model reading the page failed, or its plan refused.
    #[error(transparent)]
    Model(#[from] crate::chat::Error),
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Media(error) => error.kind(),
            Self::Provider(error) => error.kind(),
            Self::Model(error) => error.kind(),
        }
    }
}
