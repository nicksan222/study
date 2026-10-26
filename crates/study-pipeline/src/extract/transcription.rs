//! Recordings and videos: speech turned into text by the local speech model, set up as the
//! transcription preferences say, one block per segment, each anchored to its time span.

use std::path::Path;

use study_ai::Cached;
use study_ai::stt::{
    AudioInput, Transcriber, TranscriberConfig, Transcript, TranscriptionPreferences,
};
use study_core::db::Store;
use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};
use study_core::{Anchor, Block, BlockKind, Document, DocumentMeta, Failure};

/// Where the extractor gets its transcriber's configuration.
enum Setup {
    /// Always this configuration.
    Fixed(TranscriberConfig),
    /// The preferences saved in this store, read again for every source.
    Saved(Store),
}

/// Speech-to-text for recordings and videos.
pub struct TranscriptionExtractor {
    setup: Setup,
    /// Keyed by the saved preferences; `None` for a fixed configuration.
    transcriber: Cached<Option<TranscriptionPreferences>, Transcriber>,
}

impl TranscriptionExtractor {
    /// Always transcribes with `config`.
    pub fn new(config: TranscriberConfig) -> Self {
        Self::with(Setup::Fixed(config))
    }

    /// Follows the preferences saved in `store`, read again for every job.
    pub fn saved(store: Store) -> Self {
        Self::with(Setup::Saved(store))
    }

    fn with(setup: Setup) -> Self {
        Self {
            setup,
            transcriber: Cached::new(),
        }
    }

    /// The transcriber as currently set up. A new one starts only when the preferences
    /// change.
    async fn transcriber(&self) -> Result<Transcriber, Failure> {
        let (key, config) = match &self.setup {
            Setup::Fixed(config) => (None, config.clone()),
            Setup::Saved(store) => {
                let preferences = store.run(TranscriptionPreferences::load).await?;
                let config = preferences.transcriber_config();
                (Some(preferences), config)
            }
        };
        self.transcriber
            .get(key, || async {
                Transcriber::start(config).await.map_err(Failure::from)
            })
            .await
    }
}

impl Default for TranscriptionExtractor {
    /// The default local model.
    fn default() -> Self {
        Self::new(TranscriberConfig::default())
    }
}

impl Extractor for TranscriptionExtractor {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Transcription
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async move {
            let transcriber = self.transcriber().await?;
            // The name's extension is only a hint for the decoder, which probes the content.
            let extension = Path::new(&input.name)
                .extension()
                .map(|extension| extension.to_string_lossy().to_ascii_lowercase());
            let transcript = transcriber
                .transcribe(AudioInput::Encoded {
                    extension,
                    bytes: input.bytes,
                })
                .await?;
            Ok(document_of(transcript, transcriber.provider_name()))
        })
    }
}

/// A transcript as a document: one timed block per segment. A transcript without segments
/// (some providers give only text) is one block covering the whole recording.
fn document_of(transcript: Transcript, provider: &str) -> Document {
    let ms = |secs: f64| (secs.max(0.0) * 1000.0).round() as u64;
    let mut blocks: Vec<Block> = transcript
        .segments
        .iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .map(|segment| Block {
            kind: BlockKind::Segment,
            text: segment.text.trim().to_owned(),
            anchor: Anchor::Time {
                start_ms: ms(segment.start_secs),
                end_ms: ms(segment.end_secs),
            },
        })
        .collect();
    if blocks.is_empty() && !transcript.text.trim().is_empty() {
        blocks.push(Block {
            kind: BlockKind::Segment,
            text: transcript.text.trim().to_owned(),
            anchor: Anchor::Time {
                start_ms: 0,
                end_ms: ms(transcript.duration_secs),
            },
        });
    }
    Document {
        blocks,
        meta: DocumentMeta {
            provider: Some(provider.to_owned()),
            duration_ms: Some(ms(transcript.duration_secs)),
            ..DocumentMeta::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use study_ai::BatchLimits;
    use study_ai::stt::Result as TranscriptionResult;
    use study_ai::stt::provider::{Clip, Limits, Provider, ProviderConfig};

    use super::*;
    use crate::extract::attachment;

    const WAV: &[u8] = include_bytes!("../../../study-media/tests/fixtures/jfk_2s.wav");

    /// Pretends every clip says the same thing.
    struct Fixed;

    impl Provider for Fixed {
        fn name(&self) -> &'static str {
            "fixed"
        }

        fn limits(&self) -> Limits {
            Limits {
                max_clip_secs: 30.0,
                batch: BatchLimits {
                    max_batch_size: 4,
                    max_concurrent_batches: 1,
                },
            }
        }

        fn transcribe_batch(
            &self,
            clips: Vec<Clip>,
        ) -> BoxFuture<'_, Vec<TranscriptionResult<Transcript>>> {
            Box::pin(async move {
                clips
                    .iter()
                    .map(|_| Ok(Transcript::whole("and so my fellow Americans", 2.0)))
                    .collect()
            })
        }
    }

    #[tokio::test]
    async fn speech_becomes_timed_segments() -> study_core::Result<()> {
        let extractor = TranscriptionExtractor::new(TranscriberConfig {
            provider: ProviderConfig::Custom(Arc::new(Fixed)),
            ..TranscriberConfig::default()
        });
        let document = extractor.extract(attachment("speech.wav", WAV)).await?;
        assert_eq!(document.text(), "and so my fellow Americans");
        assert_eq!(document.blocks[0].kind, BlockKind::Segment);
        assert_eq!(
            document.blocks[0].anchor,
            Anchor::Time {
                start_ms: 0,
                end_ms: 2_000
            }
        );
        assert_eq!(document.meta.provider.as_deref(), Some("fixed"));
        Ok(())
    }

    #[test]
    fn a_transcript_without_segments_is_one_block() {
        let transcript = Transcript {
            text: "hello".into(),
            segments: Vec::new(),
            duration_secs: 1.5,
        };
        let document = document_of(transcript, "api");
        assert_eq!(document.blocks.len(), 1);
        assert_eq!(
            document.blocks[0].anchor,
            Anchor::Time {
                start_ms: 0,
                end_ms: 1_500
            }
        );
    }
}
