//! Speech-to-text backends behind one trait. Callers use [`crate::stt::Transcriber`]; this module
//! is public so applications can plug in their own [`Provider`].
//!
//! | File          | Backend                                          |
//! |---------------|--------------------------------------------------|
//! | `local/`      | Offline Parakeet TDT v3 model                    |
//! | `config.rs`   | [`ProviderConfig`], which picks one of the above |
//!
//! Speech is the one thing Study hears on this computer: the ChatGPT plan takes no audio.
//! To add a backend, add its file here and its variant to [`ProviderConfig`]; the compiler
//! lists the arms left to write.

mod config;
pub mod local;

use futures::future::BoxFuture;
use study_media::audio::Audio;

use crate::BatchLimits;
use crate::stt::error::Result;
use crate::stt::transcript::Transcript;

pub use config::ProviderConfig;
pub use local::{LocalConfig, LocalProvider};

/// A backend that turns clips of speech into text, a batch at a time.
pub trait Provider: Send + Sync + 'static {
    /// Short stable identifier, for example `parakeet-tdt-0.6b-v3`.
    fn name(&self) -> &'static str;

    /// What it can take at once.
    fn limits(&self) -> Limits;

    /// Transcribes every clip, returning one result per clip in the same order.
    fn transcribe_batch(&self, clips: Vec<Clip>) -> BoxFuture<'_, Vec<Result<Transcript>>>;
}

/// One piece of audio short enough for the provider, ready to transcribe.
#[derive(Clone, Debug)]
pub struct Clip {
    pub audio: Audio,
}

/// What a provider can take at once. The batcher and splitter shape work to fit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    /// Longest clip accepted; longer audio is split at pauses.
    pub max_clip_secs: f64,
    pub batch: BatchLimits,
}
