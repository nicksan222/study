//! [`Error`]: what can go wrong bringing material in from the web, and what kind each is.

use study_core::{Classify, ErrorKind};

/// A result whose error is a web [`Error`] unless it says otherwise.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Why a page or a video's sound track could not be brought in.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0:?} is not a web address")]
    Address(String),
    #[error("cannot reach the page: {0}")]
    Http(#[from] reqwest::Error),
    #[error("the page answered HTTP {0}")]
    Status(u16),
    #[error("the address holds {0}, not a web page")]
    NotAPage(String),
    /// The page or video is over the limit, in bytes, that the fetcher downloads.
    #[error("the download is larger than {} MiB", .0 >> 20)]
    TooLarge(u64),
    #[error("yt-dlp is not installed; get it from https://github.com/yt-dlp/yt-dlp")]
    VideoToolMissing,
    #[error("yt-dlp could not fetch the video: {0}")]
    VideoTool(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Address(_) | Self::NotAPage(_) | Self::TooLarge(_) => ErrorKind::InvalidInput,
            // Too many redirects, or a body that is not what it claims: the address is wrong.
            Self::Http(error) if error.is_redirect() || error.is_decode() => {
                ErrorKind::InvalidInput
            }
            Self::Http(error) => crate::error::kind_of_http(error),
            Self::Status(status) => kind_of_page_status(*status),
            Self::VideoToolMissing => ErrorKind::Config,
            // yt-dlp says why only in words: a broken link and a lost connection look alike.
            Self::VideoTool(_) => ErrorKind::InvalidInput,
            Self::Io(error) => Classify::kind(error),
        }
    }
}

/// What a page's HTTP status means. Not a model provider's: a missing page is gone rather
/// than a setting to fix, and a page that wants a login is one Study cannot read.
fn kind_of_page_status(status: u16) -> ErrorKind {
    match status {
        404 | 410 => ErrorKind::NotFound,
        429 => ErrorKind::RateLimited,
        408 | 500.. => ErrorKind::Transient,
        _ => ErrorKind::InvalidInput,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_statuses_mean_what_they_mean_for_a_page() {
        let kind = |status| Error::Status(status).kind();
        assert_eq!(kind(404), ErrorKind::NotFound);
        assert_eq!(kind(410), ErrorKind::NotFound);
        assert_eq!(kind(401), ErrorKind::InvalidInput);
        assert_eq!(kind(403), ErrorKind::InvalidInput);
        assert_eq!(kind(400), ErrorKind::InvalidInput);
        assert_eq!(kind(451), ErrorKind::InvalidInput);
        assert_eq!(kind(429), ErrorKind::RateLimited);
        for status in [408, 500, 502, 503] {
            assert_eq!(kind(status), ErrorKind::Transient, "{status}");
        }
    }
}
