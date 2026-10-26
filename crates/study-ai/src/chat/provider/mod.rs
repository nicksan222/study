//! Where models run. Each backend publishes its per-tier defaults as an
//! [`crate::ApiConfig`] and builds a Rig model; [`ProviderConfig`] picks the backend, and any
//! agent can use the model it builds, whichever provider serves it.
//!
//! | File         | Backend                                                          |
//! |--------------|------------------------------------------------------------------|
//! | `chatgpt/`   | The user's own ChatGPT plan, through Sign in with ChatGPT        |
//! | `config.rs`  | [`ProviderConfig`], which picks one of the above                 |
//!
//! Every backend has the same items: `NAME`, `default_model(tier)`, `defaults(tier)`, and
//! `model(config)`.
//!
//! To add a backend, add its module here. Every per-provider `match` is exhaustive, so after
//! adding the `LlmProvider` variant the compiler lists the arms left to write, and the tests in
//! `chat/preferences.rs` cover the new one on every tier.

pub mod chatgpt;
mod config;

pub use config::ProviderConfig;
