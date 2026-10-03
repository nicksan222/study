//! A video's sound track, through the `yt-dlp` program, stored as audio to transcribe.

use study_ai::web;
use study_core::Failure;
use study_core::processing::{BoxFuture, Fetched, Fetcher, FetcherKind};

/// Fetches the sound of video pages.
pub(super) struct VideoFetcher;

impl Fetcher for VideoFetcher {
    fn kind(&self) -> FetcherKind {
        FetcherKind::Video
    }

    fn accepts(&self, url: &str) -> bool {
        web::is_video(url)
    }

    fn fetch<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<Fetched, Failure>> {
        Box::pin(async move {
            let audio = web::fetch_video_audio(url).await?;
            Ok(Fetched::sniffed(audio.name, audio.bytes, url.to_owned()))
        })
    }
}
