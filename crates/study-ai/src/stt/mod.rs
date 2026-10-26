//! Speech-to-text for Study behind one interface.
//!
//! ```no_run
//! # async fn example() -> study_ai::stt::Result<()> {
//! use study_ai::stt::Transcriber;
//!
//! // Local Parakeet TDT 0.6B v3; the model must be installed first (about 670 MB).
//! let transcriber = Transcriber::local().await?;
//! let transcript = transcriber.transcribe(std::path::Path::new("lecture.mp3")).await?;
//! println!("{}", transcript.text);
//! # Ok(())
//! # }
//! ```
//!
//! Speech is heard on this computer, as the ChatGPT plan takes no audio; saved
//! [`TranscriptionPreferences`] set the local model up (see
//! [`TranscriptionPreferences::transcriber_config`]). Every call goes through the same
//! pipeline, whichever the provider: decode and resample to 16 kHz mono, take out background
//! noise when the recording is noisy, keep only the speech a voice activity model finds, cut
//! into clips that fit the provider, batch clips from all callers, then stitch the results.
//!
//! Where things live:
//!
//! - `transcriber.rs`: [`Transcriber`], the entry point that runs the pipeline.
//! - `preferences.rs`: [`TranscriptionPreferences`], what the user chose.
//! - `prepare/`: denoising, speech detection and clipping, with small models built in.
//! - Decoding and resampling live in `study_media::audio`.
//! - `provider/`: the [`provider::Provider`] trait and one file per backend.
//! - `transcript.rs` and `error.rs`: what comes back.
//!
//! Batching and model downloads are shared with the other capabilities in [`crate`].

mod error;
mod preferences;
mod prepare;
pub mod provider;
mod transcriber;
mod transcript;

pub use error::{Error, Result};
pub use preferences::{ModelCopies, TranscriptionForm, TranscriptionPreferences};
pub use provider::ProviderConfig;
pub use study_media::audio::AudioInput;
pub use transcriber::{Transcriber, TranscriberConfig};
pub use transcript::{Segment, Transcript};
