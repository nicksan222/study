//! Every model Study uses, behind one crate, plus fetching from the web. All network and
//! model access in Study happens here. Language work, reading pages included, runs on the
//! user's ChatGPT plan; only speech-to-text and embeddings run on this computer, as the plan
//! takes no audio and has no embeddings. Each capability keeps its provider trait, so
//! another backend is one more variant.
//!
//! | Module          | What it holds                                                    |
//! |-----------------|------------------------------------------------------------------|
//! | [`stt`]         | Speech-to-text on this computer: [`stt::Transcriber`]            |
//! | [`vision`]      | Reading pages: [`vision::Recognizer`] and its providers          |
//! | [`chat`]        | Language models by tier, on Rig: [`chat::Models`]                |
//! | [`agent`]       | Agents on those models: [`agent::AgentSpec`], [`agent::Runner`]  |
//! | [`embed`]       | Local embeddings for search: [`embed::Embedder`]                 |
//! | [`hardware`]    | Measuring this computer: [`hardware::Report`]                    |
//! | [`catalog`]     | How much of the local models this computer can run               |
//! | [`web`]         | Pages and video sound tracks fetched from the web                |
//! | [`updates`]     | Signed application updates from GitHub Releases                  |
//! | `testing`       | A mock of the ChatGPT plan for tests, behind `testing`           |
//! | `error.rs`      | [`Error`], failures any provider can have, with their kind       |
//! | `api.rs`        | [`ApiConfig`], for providers behind HTTP APIs                    |
//! | `batch.rs`      | `Batcher`, one shared queue that groups and dedupes requests     |
//! | `blocking.rs`   | CPU-bound work off the async runtime, a crash kept as an error   |
//! | `cached.rs`     | [`Cached`], one running engine kept while its setup holds        |
//! | `local/`        | [`ModelSpec`] downloads, [`ModelInstall`], `ModelPool` copies    |
//! | `http.rs`       | Every HTTP client, shared per timeouts and redirect rules        |

mod api;
mod batch;
mod blocking;
mod cached;
mod error;
mod http;
mod local;

pub mod agent;
pub mod catalog;
pub mod chat;
pub mod embed;
pub mod hardware;
pub mod stt;
pub mod updates;
pub mod vision;
pub mod web;

#[cfg(feature = "testing")]
pub mod testing;

pub use api::ApiConfig;
pub use batch::{BatchLimits, BatchingConfig};
pub(crate) use batch::{BatchWork, Batcher, Key, KeyHasher};
pub use cached::Cached;
pub use error::{Error, Result};
pub(crate) use local::ModelPool;
pub use local::{ModelFile, ModelInstall, ModelSpec};
