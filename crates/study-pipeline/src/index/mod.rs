//! A document as search passages, and the local model that embeds them. The Index and
//! Embed stages (`stages/index.rs`) keep the stored index current with these; `study-app`'s
//! search reads it.
//!
//! | File          | What it holds                                                   |
//! |---------------|-----------------------------------------------------------------|
//! | `chunk.rs`    | `chunk`, which splits one long text into overlapping pieces     |
//! | `passages.rs` | [`passages()`]: a document as passages that keep their anchors  |
//! | `excerpt.rs`  | [`excerpts_of_sources`]: sources' passages, as excerpts to cite |
//! | `embedder.rs` | [`EmbedderSlot`], the local model loaded once it is installed   |

mod chunk;
mod embedder;
mod excerpt;
mod passages;

pub use embedder::{EmbedderSlot, QueryVector};
pub use excerpt::excerpts_of_sources;
pub(crate) use passages::passages;
