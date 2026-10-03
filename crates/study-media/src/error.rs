//! [`Error`]: every way bytes can fail to become audio or pages, each with its
//! [`ErrorKind`].

use study_core::{Classify, ErrorKind};

/// This crate's `Result`, failing with [`Error`] by default.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Why bytes could not be turned into audio or pages.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The input is damaged, or a decoder or renderer rejected it; the text says why. An
    /// image in a format `pages` doesn't read is one of these too.
    #[error("cannot decode: {0}")]
    Decode(String),
    /// Nothing could read the recording: Study does not know the format and FFmpeg is
    /// missing, or the file is not a recording at all. `format` is the upper-cased extension
    /// when FFmpeg is missing, and `reason` is the decoder's own explanation, followed by
    /// FFmpeg's when it could not read the file either. Only `audio` fails this way.
    #[error("{}", unsupported(format.as_deref(), reason))]
    Unsupported {
        format: Option<String>,
        reason: String,
    },
    /// The recording decoded to nothing.
    #[error("audio contains no samples")]
    EmptyAudio,
    /// The PDF has no pages, or the image has no pixels.
    #[error("the document has no pages")]
    EmptyDocument,
    /// The PDF is longer than the crate reads.
    #[error("the document has {pages} pages; at most {max} can be read")]
    TooManyPages { pages: usize, max: usize },
    /// Reading the input, writing FFmpeg's temporary file, or running FFmpeg failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Unsupported { .. } => ErrorKind::Unsupported,
            Self::Decode(_)
            | Self::EmptyAudio
            | Self::EmptyDocument
            | Self::TooManyPages { .. } => ErrorKind::InvalidInput,
            Self::Io(error) => Classify::kind(error),
        }
    }
}

fn unsupported(format: Option<&str>, reason: &str) -> String {
    match format {
        Some(format) => format!("cannot read {format} audio without FFmpeg: {reason}"),
        None => format!("not a recording: {reason}"),
    }
}
