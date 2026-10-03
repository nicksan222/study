//! The Extract stage: reads a source into its document with the extractors its plan lists,
//! reworks it with the plan's refiners, stores it, and passes the document on.

use study_core::db::{Job, JobTarget, MAX_SOURCE_BYTES, Store};
use study_core::jobs::{Lane, wrong_target};
use study_core::processing::{BoxFuture, SourceInput, SourcePlan, Stage};
use study_core::{Document, ErrorKind, Failure, JobKind, SourceId};

use crate::{ExtractorSet, RefinerSet};

/// Reads sources, reusing the document of identical bytes read the same way before.
pub struct ExtractStage {
    store: Store,
    extractors: ExtractorSet,
    refiners: RefinerSet,
}

impl ExtractStage {
    /// Reads with `extractors`, reworks with `refiners`, into `store`.
    pub fn new(store: Store, extractors: ExtractorSet, refiners: RefinerSet) -> Self {
        Self {
            store,
            extractors,
            refiners,
        }
    }

    /// The source to read: its record and its bytes.
    async fn load(&self, source: SourceId) -> Result<SourceInput, Failure> {
        let loaded = self
            .store
            .run(move |database| {
                let Some(stored) = database.source(source)? else {
                    return Ok(None);
                };
                let bytes = database.read_source_bounded(source, MAX_SOURCE_BYTES as usize)?;
                Ok(Some((stored, bytes)))
            })
            .await?;
        let Some((stored, bytes)) = loaded else {
            return Err(Failure::new(
                ErrorKind::NotFound,
                "the source is no longer in the Library",
            ));
        };
        let Some(bytes) = bytes else {
            return Err(Failure::new(
                ErrorKind::InvalidInput,
                "the source is too large to read",
            ));
        };
        Ok(SourceInput {
            name: stored.name,
            kind: stored.kind,
            mime: stored.mime,
            uri: stored.uri,
            bytes,
        })
    }

    /// A document identical bytes were read into the way `plan` would read these: by one of
    /// its reusable extractors at its current version, refined by the same refiners.
    async fn reuse(
        &self,
        source: SourceId,
        plan: &SourcePlan,
    ) -> Result<Option<Document>, Failure> {
        let expected = self.refiners.stamps(&plan.refiners);
        for &kind in plan.extractors.iter().filter(|kind| kind.reusable()) {
            let Some(extractor) = self.extractors.get(kind) else {
                continue;
            };
            let (version, expected) = (extractor.version(), expected.clone());
            let reused = self
                .store
                .run(move |database| {
                    database.document_for_same_bytes(source, kind, version, |meta| {
                        meta.refiners == expected
                    })
                })
                .await?;
            if reused.is_some() {
                return Ok(reused);
            }
        }
        Ok(None)
    }
}

impl Stage for ExtractStage {
    fn kind(&self) -> JobKind {
        JobKind::Extract
    }

    /// Reading has a lane of its own: its models bound their own work, and a long recording
    /// must not hold up everything else.
    fn lane(&self) -> Lane {
        Lane::Reading
    }

    fn run(&self, job: Job, plan: SourcePlan) -> BoxFuture<'_, Result<Option<JobTarget>, Failure>> {
        Box::pin(async move {
            let Some(source) = job.target.source() else {
                return Err(wrong_target(&job));
            };
            // The same bytes read the same way before give the same document; the bytes are
            // only loaded when they have to be read.
            let document = match self.reuse(source, &plan).await? {
                Some(document) => document,
                None => {
                    let input = self.load(source).await?;
                    let read = self.extractors.extract(&plan.extractors, input).await?;
                    self.refiners.refine(&plan.refiners, read).await
                }
            };
            let read = job.id;
            let saved = self
                .store
                .run(move |database| database.save_read(read, source, &document))
                .await?;
            if saved.is_none() {
                // Cancelled while it read, as the user corrected the document: theirs stays.
                tracing::debug!(source = source.get(), "a read ended before it was saved");
            }
            Ok(saved.map(JobTarget::Document))
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use study_core::db::NewJob;
    use study_core::preferences::PreferenceSet as _;
    use study_core::processing::{
        Extractor, ExtractorKind, ProcessingPreferences, Refiner, RefinerKind,
    };
    use study_core::{Anchor, Block, BlockKind, Stamp};

    /// Reads any text back, counting its reads.
    struct Counting(Arc<AtomicUsize>);

    impl Extractor for Counting {
        fn kind(&self) -> ExtractorKind {
            ExtractorKind::Text
        }

        fn version(&self) -> u32 {
            1
        }

        fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                Ok(Document {
                    blocks: vec![Block {
                        kind: BlockKind::Paragraph,
                        text: String::from_utf8_lossy(&input.bytes).into_owned(),
                        anchor: Anchor::Paragraph { index: 0 },
                    }],
                    ..Document::default()
                })
            })
        }
    }

    /// The whitespace refiner at a version of the test's choosing, changing nothing.
    struct Versioned(u32);

    impl Refiner for Versioned {
        fn kind(&self) -> RefinerKind {
            RefinerKind::Whitespace
        }

        fn version(&self) -> u32 {
            self.0
        }

        fn refine(&self, document: Document) -> BoxFuture<'_, Result<Document, Failure>> {
            Box::pin(async move { Ok(document) })
        }
    }

    /// A read of `source` as the engine would start it: claimed, with its source's plan.
    fn claim(store: &Store, source: SourceId) -> (Job, SourcePlan) {
        store
            .with(|database| {
                database.enqueue_job(&NewJob::new(JobKind::Extract, JobTarget::Source(source)))?;
                let job = database.claim_job(&[JobKind::Extract])?.unwrap();
                let stored = database.source(source)?.unwrap();
                let plan = ProcessingPreferences::load(database)?.plan(stored.kind, &stored.mime);
                Ok((job, plan))
            })
            .unwrap()
    }

    async fn read(stage: &ExtractStage, store: &Store, source: SourceId) -> Document {
        let (job, plan) = claim(store, source);
        stage.run(job, plan).await.unwrap();
        store
            .with(|database| database.document_of(source))
            .unwrap()
            .unwrap()
            .1
    }

    #[tokio::test]
    async fn identical_bytes_are_reused_only_when_refined_the_same_way() {
        let (dir, store) = Store::temporary().unwrap();
        let paths = ["a.txt", "b.txt", "c.txt"].map(|name| dir.path().join(name));
        for path in &paths {
            std::fs::write(path, "same words").unwrap();
        }
        let [a, b, c] = paths.map(|path| {
            store
                .with(|database| database.import_source(&path, None))
                .unwrap()
                .id
        });
        let reads = Arc::new(AtomicUsize::new(0));
        let extractors = ExtractorSet::new(vec![Arc::new(Counting(reads.clone()))]);
        let stage = |version| {
            ExtractStage::new(
                store.clone(),
                extractors.clone(),
                RefinerSet::new(vec![Arc::new(Versioned(version))]),
            )
        };

        let first = read(&stage(1), &store, a).await;
        assert_eq!(
            first.meta.refiners,
            [Stamp {
                refiner: RefinerKind::Whitespace,
                version: 1
            }]
        );
        assert_eq!(read(&stage(1), &store, b).await, first);
        assert_eq!(reads.load(Ordering::SeqCst), 1, "reused, not read again");

        let bumped = read(&stage(2), &store, c).await;
        assert_eq!(
            reads.load(Ordering::SeqCst),
            2,
            "a refiner bump reads afresh"
        );
        assert_eq!(bumped.meta.refiners[0].version, 2);
    }

    /// Reads the text extractor's way, but only once the test lets it.
    struct Held(Arc<tokio::sync::Semaphore>);

    impl Extractor for Held {
        fn kind(&self) -> ExtractorKind {
            ExtractorKind::Text
        }

        fn version(&self) -> u32 {
            1
        }

        fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
            Box::pin(async move {
                self.0.acquire().await.unwrap().forget();
                Counting(Arc::default()).extract(input).await
            })
        }
    }

    /// A read already running when the student corrects a block, such as one queued to
    /// correct a transcript after signing in, does not replace their correction.
    #[tokio::test]
    async fn a_read_running_when_the_document_is_corrected_keeps_the_correction() {
        let (dir, store) = Store::temporary().unwrap();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "the sell divides").unwrap();
        let source = store
            .with(|database| database.import_source(&path, None))
            .unwrap()
            .id;
        let first = ExtractStage::new(
            store.clone(),
            ExtractorSet::new(vec![Arc::new(Counting(Arc::default()))]),
            RefinerSet::new(Vec::new()),
        );
        read(&first, &store, source).await;

        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        let held = ExtractStage::new(
            store.clone(),
            ExtractorSet::new(vec![Arc::new(Held(gate.clone()))]),
            RefinerSet::new(Vec::new()),
        );
        let (job, plan) = claim(&store, source);
        let reading = held.run(job, plan);
        let correct = async {
            let corrected = store
                .run(move |database| {
                    database.correct_block(source, 0, "the sell divides", "the cell divides", None)
                })
                .await
                .unwrap();
            gate.add_permits(1);
            corrected
        };
        let (read, corrected) = tokio::join!(reading, correct);

        assert_eq!(
            read.unwrap(),
            None,
            "nothing follows a read that was not saved"
        );
        let (id, document) = store
            .with(|database| database.document_of(source))
            .unwrap()
            .unwrap();
        assert_eq!(Some(id), corrected);
        assert_eq!(document.blocks[0].text, "the cell divides");
    }
}
