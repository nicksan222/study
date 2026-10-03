//! Embeddings for search, always computed on this computer.
//!
//! The model is multilingual E5 small: small (a 135 MB download), fast enough to embed a
//! page of text in milliseconds, and it covers Italian as well as English and matches across
//! the two. It is only downloaded when the user installs it ([`LocalConfig::model`]).
//!
//! | File        | What it holds                                                       |
//! |-------------|---------------------------------------------------------------------|
//! | `mod.rs`    | [`Embedder`], the interface search uses, and the [`Role`] of a text |
//! | `config.rs` | [`EmbedderConfig`], which picks the embedder and loads it           |
//! | `e5.rs`     | [`MULTILINGUAL_E5_SMALL`] and [`OnnxEmbedder`]                      |
//!
//! Another model is one more file here implementing [`Embedder`] and one more variant of
//! [`EmbedderConfig`]; its [`Embedder::model_id`] is stored with every vector, so switching
//! embeds everything again.

mod config;
mod e5;

use study_core::Result;

pub use config::{EmbedderConfig, LocalConfig};
pub use e5::{MULTILINGUAL_E5_SMALL, OnnxEmbedder};

/// What a text is for. E5 embeds queries and passages differently.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    Query,
    Passage,
}

/// Turns texts into unit-length vectors, so a dot product is their cosine similarity.
pub trait Embedder: Send + Sync {
    /// Stored with every vector; changing it embeds everything again.
    fn model_id(&self) -> &str;

    /// CPU-bound: call from a blocking context.
    fn embed(&self, texts: &[String], role: Role) -> Result<Vec<Vec<f32>>>;
}
