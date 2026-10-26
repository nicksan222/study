//! The automatic stages, one implementation of [`Stage`] per stage [`JobKind`], and
//! [`StageHandler`], which runs any stage as the job of its kind. The handler reads the
//! source's [`SourcePlan`](study_core::processing::SourcePlan) (its route, with the user's
//! switches applied) once, before the stage runs: a stage the plan no longer includes is
//! skipped rather than failed, and what follows is the plan's next stage. A stage never
//! builds follow-up jobs itself.
//!
//! | File         | Stage                                                               |
//! |--------------|---------------------------------------------------------------------|
//! | `extract.rs` | `Extract`: a source into its document, with extractors and refiners |
//! | `index.rs`   | `Index` and `Embed`: a document into passages, then vectors         |
//!
//! # Adding a stage
//!
//! Add its [`JobKind`] in `study-core`: `follows_reading` true, `builds_on` the stage whose
//! output it needs, and its code in the `jobs.kind` `CHECK` list. List it in the routes that
//! should run it, after its foundation. Implement [`Stage`] here (copy `IndexStage`), add it
//! to `Pipeline::stages`, and label it in `study-localization` and the desktop's
//! `processor_label`. A stage that is not about search also needs its own group in the
//! desktop's Processing settings (`Group::of`, held by `every_stage_switch_is_about_search`).
//! `every_stage_a_route_lists_has_an_implementation` and the exhaustive matches fail until
//! then.

mod extract;
mod index;

pub(crate) use extract::ExtractStage;
pub use index::{EmbedStage, IndexStage};

use std::sync::Arc;

use study_core::db::{Job, NewJob, Store};
use study_core::jobs::{BoxFuture, JobHandler, Lane};
use study_core::processing::{Stage, plan_for};
use study_core::{Failure, JobKind};

/// Runs a [`Stage`] as a [`JobHandler`], within the plan of the source it works on.
pub struct StageHandler {
    store: Store,
    stage: Arc<dyn Stage>,
}

impl StageHandler {
    /// Runs `stage`, reading each job's plan from `store`.
    pub fn new(store: Store, stage: Arc<dyn Stage>) -> Self {
        Self { store, stage }
    }
}

impl JobHandler for StageHandler {
    fn kind(&self) -> JobKind {
        self.stage.kind()
    }

    fn lane(&self) -> Lane {
        self.stage.lane()
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let (kind, target) = (job.kind, job.target);
            let plan = self
                .store
                .run(move |database| plan_for(database, target))
                .await?;
            // The source is gone, or the user switched this stage off after it was queued.
            let Some(plan) = plan.filter(|plan| plan.includes(kind)) else {
                tracing::debug!(?kind, ?target, "skipped: not in the plan");
                return Ok(Vec::new());
            };
            let next = plan.after(kind);
            let passed = self.stage.run(job, plan).await?;
            Ok(passed
                .zip(next)
                .map(|(target, next)| NewJob::new(next, target))
                .into_iter()
                .collect())
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use study_core::db::{ChunkDraft, JobTarget, Store};
    use study_core::preferences::PreferenceSet as _;
    use study_core::processing::{ProcessingPreferences, Processor, SourcePlan};
    use study_core::{Anchor, Block, BlockKind, Document, SourceKind};

    /// Passes its target on as a document, and counts its runs.
    struct Pass {
        kind: JobKind,
        document: study_core::DocumentId,
        runs: AtomicUsize,
    }

    impl Stage for Pass {
        fn kind(&self) -> JobKind {
            self.kind
        }

        fn lane(&self) -> Lane {
            Lane::Light
        }

        fn run(&self, _: Job, _: SourcePlan) -> BoxFuture<'_, Result<Option<JobTarget>, Failure>> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move { Ok(Some(JobTarget::Document(self.document))) })
        }
    }

    /// A store with one read and indexed PDF: its source and document.
    pub(super) fn read_pdf() -> (
        tempfile::TempDir,
        Store,
        study_core::SourceId,
        study_core::DocumentId,
    ) {
        let (dir, store) = Store::temporary().unwrap();
        let file = dir.path().join("cells.pdf");
        std::fs::write(&file, b"%PDF-1.7").unwrap();
        let (source, document) = store
            .with(|database| {
                let source = database.import_source(&file, None)?;
                let document = database.save_document(
                    source.id,
                    &Document {
                        blocks: vec![Block {
                            kind: BlockKind::Paragraph,
                            text: "text".into(),
                            anchor: Anchor::Page { page: 1 },
                        }],
                        ..Document::default()
                    },
                )?;
                database.store_chunks(
                    document,
                    &[ChunkDraft {
                        first_block: 0,
                        last_block: 0,
                        anchor: Anchor::Page { page: 1 },
                        text: "text".into(),
                    }],
                )?;
                Ok((source.id, document))
            })
            .unwrap();
        (dir, store, source, document)
    }

    fn switch_off(store: &Store, processor: Processor) {
        store
            .with(|database| {
                let mut preferences = ProcessingPreferences::load(database)?;
                preferences.set(SourceKind::Pdf, processor, false);
                preferences.save(database)
            })
            .unwrap();
    }

    /// A job of `kind` on `target`, queued in `store`.
    pub(super) fn queued(store: &Store, kind: JobKind, target: JobTarget) -> Job {
        store
            .with(|database| {
                let id = database.enqueue_job(&NewJob::new(kind, target))?;
                Ok(database.job(id)?.unwrap())
            })
            .unwrap()
    }

    async fn run(store: &Store, stage: &Arc<Pass>, target: JobTarget) -> Vec<NewJob> {
        let job = queued(store, stage.kind, target);
        StageHandler::new(store.clone(), stage.clone())
            .run(job)
            .await
            .unwrap()
    }

    fn pass(kind: JobKind, document: study_core::DocumentId) -> Arc<Pass> {
        Arc::new(Pass {
            kind,
            document,
            runs: Default::default(),
        })
    }

    fn kinds(jobs: &[NewJob]) -> Vec<JobKind> {
        jobs.iter().map(|job| job.kind).collect()
    }

    #[tokio::test]
    async fn the_handler_queues_what_the_plan_says_comes_next() {
        let (_dir, store, source, document) = read_pdf();
        let extract = pass(JobKind::Extract, document);
        let index = pass(JobKind::Index, document);
        let embed = pass(JobKind::Embed, document);
        assert_eq!(
            kinds(&run(&store, &extract, JobTarget::Source(source)).await),
            [JobKind::Index]
        );
        let target = JobTarget::Document(document);
        assert_eq!(kinds(&run(&store, &index, target).await), [JobKind::Embed]);
        assert!(run(&store, &embed, target).await.is_empty());
    }

    #[tokio::test]
    async fn a_switched_off_embed_is_skipped() {
        let (_dir, store, source, document) = read_pdf();
        switch_off(&store, Processor::Stage(JobKind::Embed));
        let extract = pass(JobKind::Extract, document);
        let embed = pass(JobKind::Embed, document);
        let after_read = run(&store, &extract, JobTarget::Source(source)).await;
        assert_eq!(kinds(&after_read), [JobKind::Index]);
        // An Embed job queued before the switch does nothing.
        assert!(
            run(&store, &embed, JobTarget::Document(document))
                .await
                .is_empty()
        );
        assert_eq!(embed.runs.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_read_switched_off_after_it_was_queued_is_skipped() {
        let (_dir, store, source, document) = read_pdf();
        switch_off(
            &store,
            Processor::Extractor(study_core::processing::ExtractorKind::Vision),
        );
        let extract = pass(JobKind::Extract, document);
        assert!(
            run(&store, &extract, JobTarget::Source(source))
                .await
                .is_empty()
        );
        assert_eq!(extract.runs.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn work_on_a_gone_source_is_skipped() {
        let (_dir, store, source, document) = read_pdf();
        let job = queued(&store, JobKind::Index, JobTarget::Document(document));
        store
            .with(|database| database.delete_source(source))
            .unwrap();
        let index = pass(JobKind::Index, document);
        let queued = StageHandler::new(store.clone(), index.clone())
            .run(job)
            .await
            .unwrap();
        assert!(queued.is_empty());
        assert_eq!(index.runs.load(Ordering::SeqCst), 0);
    }
}
