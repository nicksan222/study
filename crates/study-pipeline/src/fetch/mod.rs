//! The fetchers: one implementation of [`Fetcher`] per
//! [`FetcherKind`](study_core::processing::FetcherKind), bringing in what a link holds as
//! bytes to store as a source. [`FetchHandler`] runs them as the `Fetch` job of a link
//! source, trying them in [`study_core::processing::FETCHERS`] order; what one brings in
//! replaces the link, keeping its id, and is read by its route. The network access itself
//! is `study_ai::web`'s.
//!
//! | Fetcher          | Module     | Kind    | Accepts                                    |
//! |------------------|------------|---------|--------------------------------------------|
//! | [`VideoFetcher`] | `video.rs` | `Video` | Video pages `yt-dlp` fetches the sound of  |
//! | [`PageFetcher`]  | `page.rs`  | `Page`  | Any `http` or `https` address              |
//!
//! # Adding a fetcher
//!
//! Add its kind in `study-core` and put it in `FETCHERS` ahead of any fetcher that also
//! accepts its addresses (`Page` accepts every address, so it stays last). Copy `video.rs`,
//! add it to [`FetcherSet::builtin`] and the table above.

mod handler;
mod page;
mod video;

pub(crate) use handler::FetchHandler;
use page::PageFetcher;
use video::VideoFetcher;

use std::sync::Arc;

use study_core::processing::{FETCHERS, Fetched, Fetcher};
use study_core::{ErrorKind, Failure};

use crate::ProcessorSet;

/// The fetcher of every [`FetcherKind`](study_core::processing::FetcherKind).
pub type FetcherSet = ProcessorSet<dyn Fetcher>;

impl FetcherSet {
    /// Every fetcher Study ships. This is the one list: a new fetcher is added here.
    pub fn builtin() -> Self {
        Self::new(vec![Arc::new(VideoFetcher), Arc::new(PageFetcher)])
    }

    /// The fetcher that brings in `url`: the first in `FETCHERS` order that accepts it.
    fn fetcher_for(&self, url: &str) -> Option<&Arc<dyn Fetcher>> {
        FETCHERS
            .iter()
            .filter_map(|kind| self.get(*kind))
            .find(|fetcher| fetcher.accepts(url))
    }

    /// `url` as it is fetched, when a fetcher accepts it, and
    /// [`ErrorKind::Unsupported`] otherwise. An address typed without a scheme, such as
    /// `example.com/notes`, is taken as `https://`. Nothing is fetched.
    pub fn address(&self, url: &str) -> Result<String, Failure> {
        self.route(url).map(|(url, _)| url)
    }

    /// Brings in `url`, as [`address`](Self::address) takes it, with its fetcher.
    pub async fn fetch(&self, url: &str) -> Result<Fetched, Failure> {
        let (url, fetcher) = self.route(url)?;
        tracing::debug!(fetcher = fetcher.kind().code(), url, "fetching");
        fetcher.fetch(&url).await
    }

    /// `url` normalised, and the fetcher that brings it in.
    fn route(&self, url: &str) -> Result<(String, &Arc<dyn Fetcher>), Failure> {
        let url = normalized(url);
        let Some(fetcher) = self.fetcher_for(&url) else {
            return Err(Failure::new(
                ErrorKind::Unsupported,
                format!("Study cannot bring in {url:?}"),
            ));
        };
        Ok((url, fetcher))
    }
}

/// `url` trimmed, with `https://` in front when it does not start with a scheme (letters,
/// then letters, digits, `+`, `-` or `.`, then `://`).
fn normalized(url: &str) -> String {
    let url = url.trim();
    let scheme = url.split_once("://").map(|(scheme, _)| scheme);
    let has_scheme = scheme.is_some_and(|scheme| {
        let mut chars = scheme.chars();
        chars
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    });
    if has_scheme {
        url.to_owned()
    } else {
        format!("https://{url}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::processing::FetcherKind;

    #[test]
    fn videos_go_to_the_video_fetcher_and_everything_else_to_the_page() {
        let set = FetcherSet::builtin();
        let first = |url: &str| set.fetcher_for(url).map(|fetcher| fetcher.kind());
        assert_eq!(first("https://youtu.be/abc"), Some(FetcherKind::Video));
        assert_eq!(first("https://example.com/notes"), Some(FetcherKind::Page));
        assert_eq!(first("HTTPS://Example.com/notes"), Some(FetcherKind::Page));
        assert_eq!(first("ftp://example.com/notes"), None);
    }

    #[test]
    fn an_address_without_a_scheme_is_taken_as_https() {
        assert_eq!(
            normalized(" example.com/notes "),
            "https://example.com/notes"
        );
        assert_eq!(normalized("http://example.com"), "http://example.com");
        assert_eq!(
            normalized("example.com/?next=https://x"),
            "https://example.com/?next=https://x"
        );
    }

    #[test]
    fn an_address_is_checked_without_fetching_it() {
        let set = FetcherSet::builtin();
        assert_eq!(
            set.address(" example.com/notes ").unwrap(),
            "https://example.com/notes"
        );
        assert_eq!(
            set.address("ftp://example.com/notes").unwrap_err().kind,
            ErrorKind::Unsupported
        );
    }

    #[test]
    fn every_fetcher_kind_has_a_fetcher_and_a_place_in_the_order() {
        assert_eq!(FetcherSet::builtin().missing(), []);
        for kind in FetcherKind::ALL {
            assert!(FETCHERS.contains(kind), "{kind:?} is not in FETCHERS");
        }
    }
}
