//! Page readers behind one trait. Callers use [`crate::vision::Recognizer`]; this module is
//! public so applications can plug in their own [`Provider`].
//!
//! | File         | Backend                                                         |
//! |--------------|-----------------------------------------------------------------|
//! | `model.rs`   | A language model that sees images, such as the ChatGPT plan's   |
//! | `config.rs`  | [`ProviderConfig`], which picks one of the above                |
//!
//! To add a backend, such as an OCR model on this computer, add its file here and its
//! variant to [`ProviderConfig`]; the compiler lists the arms left to write.

mod config;
mod model;

use futures::future::BoxFuture;
use study_media::pages::PageImage;

use crate::BatchLimits;
use crate::vision::error::Result;

pub use config::ProviderConfig;
pub use model::ModelProvider;

/// A backend that turns page images into Markdown, a batch at a time.
pub trait Provider: Send + Sync + 'static {
    /// Short stable identifier, for example `language-model`.
    fn name(&self) -> &'static str;

    /// What it can take at once.
    fn limits(&self) -> Limits;

    /// Reads every page, returning its Markdown, one result per page in the same order.
    fn read_batch(&self, pages: Vec<PageImage>) -> BoxFuture<'_, Vec<Result<String>>>;
}

/// What a provider can take at once. The recognizer and batcher shape work to fit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    /// Longest side of a page image, in pixels; larger images are scaled down and PDF pages
    /// are rendered to this size.
    pub max_image_side: u32,
    pub batch: BatchLimits,
}
