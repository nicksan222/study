//! Search across everything in Study: names, what was read from every source (keyword and
//! semantic matches fused), and chat messages. Semantic matching uses a small local model and
//! never sends text to another computer. The index itself (passages, embeddings) is kept by
//! the pipeline's Index and Embed stages in `study-pipeline`.
//!
//! | File          | What it holds                                                       |
//! |---------------|---------------------------------------------------------------------|
//! | `rank.rs`     | Reciprocal rank fusion and nearest-vector search                    |
//! | `searcher.rs` | [`Searcher`], which answers a query                                 |
//! | `retriever.rs`| `Retriever`, the passages an answer to a question may draw on       |

mod rank;
mod retriever;
mod searcher;

pub(crate) use retriever::Retriever;
pub use searcher::{SearchResults, Searcher};
