//! Offline transcription on this machine.
//!
//! - `provider.rs`: [`LocalProvider`], a pool of loaded model copies.
//! - `parakeet.rs`: the model itself, Parakeet TDT 0.6B v3, and its pinned files.
//!
//! Downloading and pooling are shared with other local models, in [`crate`].

mod parakeet;
mod provider;

pub use parakeet::PARAKEET_TDT_V3_INT8;
pub use provider::{LocalConfig, LocalProvider};
