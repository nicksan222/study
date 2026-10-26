//! The refiners: one implementation of [`Refiner`] per [`RefinerKind`], reworking a
//! freshly extracted [`Document`] before it is stored, such as correcting a transcript. The
//! routes say which run for each kind of source, in order; they run inside the Extract
//! stage, so what is stored stays the one canonical document of its source.
//!
//! | Refiner               | Module          | Kind         | Does                                           |
//! |-----------------------|-----------------|--------------|------------------------------------------------|
//! | [`TranscriptRefiner`] | `transcript.rs` | `Transcript` | Corrects what was heard, with a language model |
//! | [`WhitespaceRefiner`] | `whitespace.rs` | `Whitespace` | Tidies whitespace, drops empty blocks          |
//!
//! # Adding a refiner
//!
//! Add its [`RefinerKind`] in `study-core` and list it in the routes it should run in. Then
//! copy `whitespace.rs` (or `transcript.rs`, holding an [`AgentRuntime`] for one that uses a
//! language model), add it to [`RefinerSet::builtin`] and the table above. Each document
//! records the refiners it went through
//! ([`DocumentMeta::refiners`](study_core::DocumentMeta::refiners)), so bumping a refiner's
//! version reads identical bytes afresh instead of reusing them. A refiner that failed is
//! recorded too ([`DocumentMeta::waiting_for`](study_core::DocumentMeta::waiting_for)), so
//! the read is caught up once the refiner can run; a refiner switched on later applies only
//! to what is read from then on.

mod transcript;
mod whitespace;

use transcript::TranscriptRefiner;
use whitespace::WhitespaceRefiner;

use std::sync::Arc;

use study_ai::agent::AgentRuntime;
use study_core::processing::{Refiner, RefinerKind};
use study_core::{Document, Stamp};

use crate::ProcessorSet;

/// The refiner of every [`RefinerKind`].
pub type RefinerSet = ProcessorSet<dyn Refiner>;

impl RefinerSet {
    /// Every refiner Study ships, running language models on `agents`. This is the one
    /// list: a new refiner is added here.
    pub fn builtin(agents: &AgentRuntime) -> Self {
        Self::new(vec![
            Arc::new(TranscriptRefiner::new(agents)),
            Arc::new(WhitespaceRefiner),
        ])
    }

    /// What a document refined by every refiner of `kinds` records.
    pub(crate) fn stamps(&self, kinds: &[RefinerKind]) -> Vec<Stamp> {
        kinds
            .iter()
            .filter_map(|kind| self.get(*kind))
            .map(|refiner| stamp(refiner.as_ref()))
            .collect()
    }

    /// `document` through the refiners of `kinds`, in order, stamped with those that ran
    /// and waiting for those that failed.
    ///
    /// A finished read is never thrown away: a refiner that fails, for whatever reason (no
    /// sign-in, a rate limit, the network, the work stopping), is logged and left out, and
    /// the read is stored without its stamp, waiting for it. Failing the read instead would
    /// read it all again on every retry (a long recording's whole transcription) and, once
    /// retries ran out, leave the source with no document at all. A source waiting for a
    /// language model's refiner is read again when background work starts and when the
    /// user signs in, while that refiner is still on, and its bytes are read afresh rather
    /// than reused.
    pub async fn refine(&self, kinds: &[RefinerKind], mut document: Document) -> Document {
        let (mut stamps, mut waiting_for) = (Vec::new(), Vec::new());
        for kind in kinds {
            // Unlike a missing extractor, a missing refiner cannot lose the read, so it is
            // only logged: the document is stored unrefined.
            let Some(refiner) = self.get(*kind) else {
                tracing::warn!(?kind, "no refiner of this kind");
                continue;
            };
            // A refiner reworks the blocks; the meta stays what the extractor recorded.
            let meta = document.meta.clone();
            match refiner.refine(document.clone()).await {
                Ok(refined) => {
                    document = Document { meta, ..refined };
                    stamps.push(stamp(refiner.as_ref()));
                }
                Err(failure) => {
                    tracing::warn!(
                        ?kind,
                        error = ?failure.kind,
                        %failure,
                        "a refiner failed; the read is kept without it"
                    );
                    waiting_for.push(*kind);
                }
            }
        }
        document.meta.refiners = stamps;
        document.meta.waiting_for = waiting_for;
        document
    }
}

/// What a document records of having gone through `refiner`.
fn stamp(refiner: &dyn Refiner) -> Stamp {
    Stamp {
        refiner: refiner.kind(),
        version: refiner.version(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::processing::BoxFuture;
    use study_core::{Anchor, Block, BlockKind, ErrorKind, Failure};

    /// Uppercases everything, as the whitespace kind.
    struct Shout;

    impl Refiner for Shout {
        fn kind(&self) -> RefinerKind {
            RefinerKind::Whitespace
        }

        fn version(&self) -> u32 {
            2
        }

        fn refine(&self, mut document: Document) -> BoxFuture<'_, Result<Document, Failure>> {
            Box::pin(async move {
                for block in &mut document.blocks {
                    block.text = block.text.to_uppercase();
                }
                document.meta.extractor = None;
                Ok(document)
            })
        }
    }

    #[tokio::test]
    async fn refiners_keep_the_meta_and_stamp_the_document() {
        let set = RefinerSet::new(vec![Arc::new(Shout)]);
        let mut document = Document {
            blocks: vec![Block {
                kind: BlockKind::Paragraph,
                text: "hello".into(),
                anchor: Anchor::Page { page: 1 },
            }],
            ..Document::default()
        };
        document.meta.extractor = Some(study_core::processing::ExtractorKind::Vision);
        let refined = set
            .refine(&[RefinerKind::Whitespace], document.clone())
            .await;
        assert_eq!(refined.text(), "HELLO");
        assert_eq!(refined.meta.extractor, document.meta.extractor);
        assert_eq!(
            refined.meta.refiners,
            [Stamp {
                refiner: RefinerKind::Whitespace,
                version: 2
            }]
        );
        assert!(refined.meta.waiting_for.is_empty());
        let untouched = set.refine(&[], document).await;
        assert_eq!(untouched.text(), "hello");
        assert!(untouched.meta.refiners.is_empty());
        assert!(untouched.meta.waiting_for.is_empty());
    }

    /// Always fails, with its kind.
    struct Broken(ErrorKind);

    impl Refiner for Broken {
        fn kind(&self) -> RefinerKind {
            RefinerKind::Whitespace
        }

        fn version(&self) -> u32 {
            1
        }

        fn refine(&self, _: Document) -> BoxFuture<'_, Result<Document, Failure>> {
            Box::pin(async { Err(Failure::new(self.0, "broken")) })
        }
    }

    fn kept() -> Document {
        Document {
            blocks: vec![Block {
                kind: BlockKind::Paragraph,
                text: "kept".into(),
                anchor: Anchor::Page { page: 1 },
            }],
            ..Document::default()
        }
    }

    /// Whatever stopped the refiner, even something that passes by itself, the read is kept,
    /// unrefined, without its stamp and waiting for it, so it is caught up later instead of
    /// read again now.
    #[tokio::test]
    async fn a_refiner_that_fails_keeps_the_read_waiting_for_it() {
        for kind in [
            ErrorKind::InvalidInput,
            ErrorKind::Config,
            ErrorKind::Auth,
            ErrorKind::Transient,
            ErrorKind::RateLimited,
            ErrorKind::Cancelled,
        ] {
            let refined = RefinerSet::new(vec![Arc::new(Broken(kind))])
                .refine(&[RefinerKind::Whitespace], kept())
                .await;
            assert_eq!(refined.text(), "kept", "{kind:?}");
            assert!(refined.meta.refiners.is_empty(), "{kind:?}");
            assert_eq!(
                refined.meta.waiting_for,
                [RefinerKind::Whitespace],
                "{kind:?}"
            );
        }
    }

    #[test]
    fn every_refiner_kind_has_a_refiner() {
        let (_dir, store) = study_core::db::Store::temporary().unwrap();
        let set = RefinerSet::builtin(&AgentRuntime::saved(store));
        assert_eq!(set.missing(), []);
        for kind in RefinerKind::ALL {
            let version = set.get(*kind).map(|refiner| refiner.version());
            assert!(version >= Some(1), "{kind:?} has version 0");
        }
    }
}
