//! Bringing in material from the web: a page's HTML, or a video's sound track through the
//! `yt-dlp` program. What is brought in is stored as a source and read like any other.
//!
//! | File         | What it holds                                              |
//! |--------------|------------------------------------------------------------|
//! | `page.rs`    | [`is_page`] and [`fetch_page`]: a page's HTML and charset  |
//! | `video.rs`   | [`is_video`] and [`fetch_video_audio`], through `yt-dlp`   |
//! | `error.rs`   | [`Error`], each failure with its kind                      |

mod error;
mod page;
mod video;

pub use error::{Error, Result};
pub use page::{Page, fetch_page, is_page};
pub use video::{VideoAudio, fetch_video_audio, is_video};
