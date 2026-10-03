//! [`Transcriber`]: decode, clean up and keep only the speech, batch through the provider,
//! stitch.

use std::sync::Arc;

use futures::future::{BoxFuture, try_join_all};
use study_media::audio::{Audio, AudioInput};

use crate::blocking::blocking;
use crate::stt::error::{Error, Result};
use crate::stt::prepare;
use crate::stt::provider::{Clip, Provider, ProviderConfig};
use crate::stt::transcript::Transcript;
use crate::{BatchLimits, BatchWork, Batcher, BatchingConfig, Key, KeyHasher};

/// Who fails when a recording cannot be decoded or prepared.
const DECODER: &str = "audio decoder";

/// What a [`Transcriber`] starts with.
#[derive(Clone, Debug, Default)]
pub struct TranscriberConfig {
    /// The backend that hears the clips.
    pub provider: ProviderConfig,
    /// How clips from every caller are gathered into the provider's batches.
    pub batching: BatchingConfig,
}

/// Turns audio into text through whichever provider it was started with.
///
/// Cloning is cheap and clones share one queue, so concurrent calls from anywhere in the app
/// are batched together.
#[derive(Clone)]
pub struct Transcriber {
    inner: Arc<Inner>,
}

struct Inner {
    batcher: Batcher<Work>,
    provider: &'static str,
    max_clip_secs: f64,
}

impl Transcriber {
    /// Starts with the default local model, which must be installed first.
    pub async fn local() -> Result<Self> {
        Self::start(TranscriberConfig::default()).await
    }

    /// Prepares the provider and starts the batching task on the current Tokio runtime.
    pub async fn start(config: TranscriberConfig) -> Result<Self> {
        let provider = config.provider.build().await?;
        let inner = Inner {
            provider: provider.name(),
            max_clip_secs: provider.limits().max_clip_secs,
            batcher: Batcher::spawn(Arc::new(Work(provider)), config.batching),
        };
        Ok(Self {
            inner: Arc::new(inner),
        })
    }

    /// The provider's stable name, recorded with what it transcribed.
    pub fn provider_name(&self) -> &'static str {
        self.inner.provider
    }

    /// Decodes the input, removes background noise when there is much of it, keeps only the
    /// speech cut into clips the provider accepts, transcribes those through the shared batch
    /// queue, and joins them back with timings relative to the whole input.
    pub async fn transcribe(&self, input: impl Into<AudioInput>) -> Result<Transcript> {
        let input = input.into();
        let max_clip_secs = self.inner.max_clip_secs;
        let (duration_secs, pieces) = blocking(DECODER, move || -> Result<_> {
            let audio = Audio::load(input)?;
            let duration_secs = audio.duration_secs();
            let pieces = prepare::clips(audio, max_clip_secs)?
                .into_iter()
                .map(|(offset, audio)| {
                    let key = clip_key(&audio);
                    (offset, audio, key)
                })
                .collect::<Vec<_>>();
            Ok((duration_secs, pieces))
        })
        .await?;

        let parts = try_join_all(pieces.into_iter().map(|(offset, audio, key)| {
            let clip = Clip { audio };
            async move { Ok::<_, Error>((offset, self.inner.batcher.submit(clip, key).await?)) }
        }))
        .await?;
        let mut transcript = Transcript::stitch(parts);
        // Silence around and between the clips is part of the recording too.
        transcript.duration_secs = duration_secs;
        Ok(transcript)
    }
}

/// Identical clips: same samples.
fn clip_key(audio: &Audio) -> Key {
    let mut hasher = KeyHasher::default();
    for sample in audio.samples() {
        hasher.update(sample.to_le_bytes());
    }
    hasher.finish()
}

/// Lets the shared batch queue drive a provider.
struct Work(Arc<dyn Provider>);

impl BatchWork for Work {
    type Item = Clip;
    type Output = Transcript;
    type Error = Error;

    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn limits(&self) -> BatchLimits {
        self.0.limits().batch
    }

    fn run(&self, clips: Vec<Clip>) -> BoxFuture<'_, Vec<Result<Transcript>>> {
        self.0.transcribe_batch(clips)
    }
}
