//! The extractors: one implementation of [`Extractor`] per
//! [`ExtractorKind`], turning a stored source into its one canonical [`Document`], with
//! blocks anchored to where they came from. Which sources each reads, and in what order they
//! are tried, is [`ROUTES`](study_core::processing::ROUTES)' decision; the models behind the
//! two that need one are `study-ai`'s: speech-to-text on this computer, and the language
//! models of the ChatGPT plan for pages.
//!
//! | Extractor                  | Module             | Kind            | Anchors                      |
//! |----------------------------|--------------------|-----------------|------------------------------|
//! | [`TranscriptionExtractor`] | `transcription.rs` | `Transcription` | `Time`, one per segment      |
//! | [`VisionExtractor`]        | `vision.rs`        | `Vision`        | `Page`                       |
//! | [`OfficeExtractor`]        | `office/`          | `Office`        | `Paragraph`, `Slide`         |
//! | [`WebExtractor`]           | `web.rs`           | `Web`           | `Url`, with the section's id |
//! | [`TextExtractor`]          | `text.rs`          | `Text`          | `Text`, by lines and bytes   |
//!
//! Every extractor module has the same shape: a `//!` header saying what it reads and how it
//! anchors, the extractor type, its [`Extractor`] impl (`kind`, `version`, `extract`), the
//! private reading code, and inline tests on its text and anchors.
//!
//! # Adding an extractor
//!
//! Add its [`ExtractorKind`] in `study-core` (with its code in the `documents.extractor`
//! `CHECK` list) and name it in the routes that use it. Then copy the closest sibling:
//! `text.rs` for a parser with no model, `web.rs` for one that parses on the blocking pool,
//! `vision.rs` for one backed by a language model, and `office/` for several formats behind
//! one kind. Declare the module, re-export the type, add it to `builtin` below and to the
//! table above; `every_extractor_kind_has_an_extractor` fails until then.
//!
//! Extractors never touch the database beyond reading their preferences; the Extract stage
//! stores what they return.

mod office;
mod text;
mod transcription;
mod vision;
mod web;

use office::OfficeExtractor;
pub use text::TextExtractor;
pub use transcription::TranscriptionExtractor;
pub use vision::VisionExtractor;
pub use web::WebExtractor;
pub(crate) use web::{charset_encoding, decode};

use std::sync::Arc;

use study_ai::agent::AgentRuntime;
use study_core::db::Store;
use study_core::processing::{Extractor, ExtractorKind, SourceInput, SourcePlan};
use study_core::{BlockKind, Document, ErrorKind, Failure};

use crate::ProcessorSet;

/// The extractor of every [`ExtractorKind`].
pub type ExtractorSet = ProcessorSet<dyn Extractor>;

impl ExtractorSet {
    /// Every extractor Study ships, reading their settings from `store` and seeing pages
    /// with the models of `agents`. This is the one list of extractors: a new one is added
    /// here.
    pub fn builtin(store: Store, agents: &AgentRuntime) -> Self {
        Self::new(builtin(
            TranscriptionExtractor::saved(store),
            VisionExtractor::saved(agents.clone()),
        ))
    }

    /// Every extractor Study ships, with default settings instead of saved ones.
    #[cfg(test)]
    pub(crate) fn shipped() -> Self {
        let (_dir, store) = Store::temporary().expect("a database");
        Self::new(builtin(
            TranscriptionExtractor::default(),
            VisionExtractor::saved(AgentRuntime::saved(store)),
        ))
    }

    /// Whether a source with this plan can be read: the plan reads it, and lists an
    /// extractor this set has. (A plan alone says what the user wants read; this also asks
    /// whether the running app can, which differs only with test doubles.)
    pub fn can_read(&self, plan: &SourcePlan) -> bool {
        plan.extractors.iter().any(|kind| self.get(*kind).is_some())
    }

    /// Reads a source with the extractors of `kinds` in order, falling through on
    /// [`ErrorKind::Unsupported`]. The document records which extractor and version read
    /// it.
    pub async fn extract(
        &self,
        kinds: &[ExtractorKind],
        input: SourceInput,
    ) -> Result<Document, Failure> {
        // A planned extractor that is not registered is a bug in how the app was put
        // together, and reading without it could store a worse document as the real one.
        let extractors = kinds
            .iter()
            .map(|kind| {
                self.get(*kind).ok_or_else(|| {
                    Failure::new(
                        ErrorKind::Internal,
                        format!("no extractor of kind {kind:?} is registered"),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let Some((last, earlier)) = extractors.split_last() else {
            return Err(Failure::new(
                ErrorKind::Unsupported,
                "Study does not read files of this kind",
            ));
        };
        // Sources can be large: copy them only while another extractor may still need them.
        for extractor in earlier {
            match read_with(extractor, input.clone()).await {
                Err(failure) if failure.kind == ErrorKind::Unsupported => {
                    let kind = extractor.kind();
                    tracing::debug!(?kind, %failure, "unsupported; trying the next extractor");
                }
                result => return result,
            }
        }
        read_with(last, input).await
    }
}

/// Reads `input` with `extractor`, stamping the document with its kind and version.
async fn read_with(
    extractor: &Arc<dyn Extractor>,
    input: SourceInput,
) -> Result<Document, Failure> {
    let mut document = extractor.extract(input).await?;
    document.meta.extractor = Some(extractor.kind());
    document.meta.extractor_version = extractor.version();
    Ok(document)
}

/// The shipped extractors; the two that need settings are passed in. Shared by
/// [`ExtractorSet::builtin`] and the tests, so there is one list.
fn builtin(
    transcription: TranscriptionExtractor,
    vision: VisionExtractor,
) -> Vec<Arc<dyn Extractor>> {
    vec![
        Arc::new(transcription),
        Arc::new(vision),
        Arc::new(OfficeExtractor),
        Arc::new(WebExtractor),
        Arc::new(TextExtractor),
    ]
}

/// What a Markdown paragraph is, from how it starts: a heading, a table, a list item, or
/// plain text. The one rule for Markdown files and the pages models write.
fn markdown_kind(paragraph: &str) -> BlockKind {
    if paragraph.starts_with('#') {
        BlockKind::Heading
    } else if paragraph.starts_with('|') {
        BlockKind::Table
    } else if paragraph.starts_with("- ") || paragraph.starts_with("* ") {
        BlockKind::ListItem
    } else {
        BlockKind::Paragraph
    }
}

/// A file as the Extract stage hands it over, sniffed from its name and bytes; for the
/// extractors' tests.
#[cfg(test)]
pub(crate) fn attachment(name: &str, bytes: &[u8]) -> SourceInput {
    let detected = study_core::sniff(name, bytes);
    SourceInput {
        uri: None,
        name: name.into(),
        kind: detected.kind,
        mime: detected.mime.into(),
        bytes: bytes.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::processing::BoxFuture;
    use study_core::{Anchor, Block, BlockKind, SourceKind};

    /// Reads everything as its kind, or refuses as told.
    struct Fixed {
        kind: ExtractorKind,
        refuse: Option<ErrorKind>,
    }

    impl Extractor for Fixed {
        fn kind(&self) -> ExtractorKind {
            self.kind
        }

        fn version(&self) -> u32 {
            3
        }

        fn extract(&self, _: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
            Box::pin(async move {
                if let Some(kind) = self.refuse {
                    return Err(Failure::new(kind, self.kind.code()));
                }
                Ok(Document {
                    blocks: vec![Block {
                        kind: BlockKind::Paragraph,
                        text: self.kind.code().into(),
                        anchor: Anchor::Page { page: 1 },
                    }],
                    ..Document::default()
                })
            })
        }
    }

    fn pdf() -> SourceInput {
        SourceInput {
            name: "slides.pdf".into(),
            kind: SourceKind::Pdf,
            mime: "application/pdf".into(),
            uri: None,
            bytes: Vec::new(),
        }
    }

    fn set(extractors: Vec<Fixed>) -> ExtractorSet {
        ExtractorSet::new(
            extractors
                .into_iter()
                .map(|extractor| Arc::new(extractor) as Arc<dyn Extractor>)
                .collect(),
        )
    }

    const BOTH: &[ExtractorKind] = &[ExtractorKind::Text, ExtractorKind::Vision];

    #[tokio::test]
    async fn an_unsupported_source_falls_through_to_the_next_extractor() {
        let extractors = set(vec![
            Fixed {
                kind: ExtractorKind::Text,
                refuse: Some(ErrorKind::Unsupported),
            },
            Fixed {
                kind: ExtractorKind::Vision,
                refuse: None,
            },
        ]);
        let document = extractors.extract(BOTH, pdf()).await.unwrap();
        assert_eq!(document.text(), "vision");
        assert_eq!(
            (document.meta.extractor, document.meta.extractor_version),
            (Some(ExtractorKind::Vision), 3)
        );
    }

    #[tokio::test]
    async fn other_failures_stop_at_once() {
        let extractors = set(vec![
            Fixed {
                kind: ExtractorKind::Text,
                refuse: Some(ErrorKind::Auth),
            },
            Fixed {
                kind: ExtractorKind::Vision,
                refuse: None,
            },
        ]);
        assert_eq!(
            extractors.extract(BOTH, pdf()).await.unwrap_err().kind,
            ErrorKind::Auth
        );
    }

    #[tokio::test]
    async fn nothing_to_read_with_is_unsupported_and_a_missing_extractor_a_bug() {
        assert_eq!(
            set(Vec::new()).extract(&[], pdf()).await.unwrap_err().kind,
            ErrorKind::Unsupported
        );
        assert_eq!(
            set(Vec::new()).extract(BOTH, pdf()).await.unwrap_err().kind,
            ErrorKind::Internal
        );
    }

    #[tokio::test]
    async fn the_last_extractors_unsupported_is_returned_as_is() {
        let extractors = set(vec![
            Fixed {
                kind: ExtractorKind::Text,
                refuse: Some(ErrorKind::Unsupported),
            },
            Fixed {
                kind: ExtractorKind::Vision,
                refuse: Some(ErrorKind::Unsupported),
            },
        ]);
        let failure = extractors.extract(BOTH, pdf()).await.unwrap_err();
        assert_eq!(
            (failure.kind, failure.message.as_str()),
            (ErrorKind::Unsupported, "vision")
        );
    }

    #[test]
    fn every_extractor_kind_has_an_extractor() {
        let set = ExtractorSet::shipped();
        assert_eq!(set.missing(), []);
        for kind in ExtractorKind::ALL {
            let version = set.get(*kind).map(|extractor| extractor.version());
            assert!(version >= Some(1), "{kind:?} has version 0");
        }
    }
}
