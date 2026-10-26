//! Seeing pages for Study behind one interface: images and PDFs in, Markdown out, page by
//! page, whichever provider reads them: today a language model that sees images; an OCR
//! model on this computer would be one more provider.
//!
//! ```no_run
//! # async fn example(models: study_ai::chat::Models) -> study_ai::vision::Result<()> {
//! use study_ai::chat::Tier;
//! use study_ai::vision::{ProviderConfig, Recognizer, RecognizerConfig};
//!
//! // Pages read by the medium tier's model, which sees images, for an Italian student.
//! let recognizer = Recognizer::start(RecognizerConfig::new(ProviderConfig::Model(
//!     models.model(Tier::Medium),
//!     study_core::Language::Italian,
//! )));
//! let recognized = recognizer.recognize(std::path::Path::new("slides.pdf")).await?;
//! println!("{}", recognized.text);
//! # Ok(())
//! # }
//! ```
//!
//! Every call goes through the same pipeline, whichever the provider: decode the image or
//! render each PDF page at the size the provider wants, batch pages from all callers, then
//! join the Markdown in page order.
//!
//! Where things live:
//!
//! - `recognizer.rs`: [`Recognizer`], the entry point that runs the pipeline.
//! - Image decoding, PDF rendering and PNG encoding live in `study_media::pages`.
//! - `provider/`: the [`provider::Provider`] trait and one file per backend.
//! - `recognized.rs` and `error.rs`: what comes back.
//!
//! Batching is shared with the other capabilities in [`crate`].

mod error;
pub mod provider;
mod recognized;
mod recognizer;

pub use error::{Error, Result};
pub use provider::ProviderConfig;
pub use recognized::{PageText, Recognized};
pub use recognizer::{Recognizer, RecognizerConfig};
pub use study_media::pages::{DocumentInput, PageImage};
