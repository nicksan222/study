//! The stages that keep the search index current: Index splits a document into passages,
//! and Embed gives its passages vectors once the local search model is installed.

use std::sync::Arc;

use study_ai::embed::{Embedder, Role};
use study_core::db::{Job, JobTarget, PendingPassage, Store};
use study_core::jobs::{Lane, off_thread, wrong_target};
use study_core::processing::{BoxFuture, SourcePlan, Stage};
use study_core::{DocumentId, ErrorKind, Failure, JobKind};

use crate::index::{EmbedderSlot, passages};

/// Passages embedded per model call.
const EMBED_BATCH: usize = 16;

/// Splits a document into search passages, then passes it on to be embedded.
pub struct IndexStage {
    store: Store,
}

impl IndexStage {
    /// Indexes into `store`.
    pub fn new(store: Store) -> Self {
        Self { store }
    }
}

impl Stage for IndexStage {
    fn kind(&self) -> JobKind {
        JobKind::Index
    }

    fn lane(&self) -> Lane {
        Lane::Light
    }

    fn run(
        &self,
        job: Job,
        _plan: SourcePlan,
    ) -> BoxFuture<'_, Result<Option<JobTarget>, Failure>> {
        Box::pin(async move {
            let document = document_of(&job)?;
            let indexed = self
                .store
                .run(move |database| {
                    let Some(read) = database.document(document)? else {
                        // Replaced or deleted meanwhile: its successor has its own job.
                        return Ok(false);
                    };
                    database.store_chunks(document, &passages(&read))?;
                    Ok(true)
                })
                .await?;
            Ok(indexed.then_some(JobTarget::Document(document)))
        })
    }
}

/// Embeds a document's passages with the local search model. Does nothing while the model
/// is not installed; installing it queues this job for everything read so far.
pub struct EmbedStage {
    store: Store,
    embedder: EmbedderSlot,
}

impl EmbedStage {
    /// Embeds with the model in `embedder`, into `store`.
    pub fn new(store: Store, embedder: EmbedderSlot) -> Self {
        Self { store, embedder }
    }

    /// Embeds one batch of passages with `embedder`, and stores their vectors under `model`.
    /// The model runs off the async workers, without holding a database connection.
    async fn embed_batch(
        &self,
        embedder: &Arc<dyn Embedder>,
        model: &str,
        batch: &[PendingPassage],
    ) -> Result<(), Failure> {
        let texts: Vec<String> = batch.iter().map(|passage| passage.text.clone()).collect();
        let hashes: Vec<[u8; 32]> = batch.iter().map(|passage| passage.content_hash).collect();
        let embedder = embedder.clone();
        let vectors = off_thread(move || embedder.embed(&texts, Role::Passage))
            .await?
            .map_err(model_unavailable)?;
        if vectors.len() != hashes.len() {
            return Err(Failure::new(
                ErrorKind::ModelUnavailable,
                format!(
                    "the search model returned {} vectors for {} passages",
                    vectors.len(),
                    hashes.len()
                ),
            ));
        }
        let embedded: Vec<_> = hashes.into_iter().zip(vectors).collect();
        let model = model.to_owned();
        self.store
            .run(move |database| database.set_embeddings(&model, &embedded))
            .await
            .map_err(Failure::from)
    }
}

impl Stage for EmbedStage {
    fn kind(&self) -> JobKind {
        JobKind::Embed
    }

    fn lane(&self) -> Lane {
        Lane::Light
    }

    fn run(
        &self,
        job: Job,
        _plan: SourcePlan,
    ) -> BoxFuture<'_, Result<Option<JobTarget>, Failure>> {
        Box::pin(async move {
            let document = document_of(&job)?;
            let slot = self.embedder.clone();
            let embedder = off_thread(move || slot.get())
                .await?
                .map_err(model_unavailable)?;
            // Queued before the model was removed: nothing to do until it is installed again.
            let Some(embedder) = embedder else {
                return Ok(None);
            };
            let model = embedder.model_id().to_owned();
            let pending = {
                let model = model.clone();
                self.store
                    .run(move |database| database.passages_to_embed(document, &model))
                    .await?
            };
            for batch in pending.chunks(EMBED_BATCH) {
                // Read again meanwhile: the new document has its own Embed job.
                let gone = self
                    .store
                    .run(move |database| Ok(database.source_of_document(document)?.is_none()))
                    .await?;
                if gone {
                    return Ok(None);
                }
                self.embed_batch(&embedder, &model, batch).await?;
            }
            Ok(Some(JobTarget::Document(document)))
        })
    }
}

/// The search model failing to load or to embed.
fn model_unavailable(error: impl std::fmt::Display) -> Failure {
    Failure::new(ErrorKind::ModelUnavailable, format!("{error:#}"))
}

/// The document an Index or Embed stage works on.
fn document_of(job: &Job) -> Result<DocumentId, Failure> {
    job.target.document().ok_or_else(|| wrong_target(job))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stages::tests::{queued, read_pdf};

    /// Returns one vector fewer than it was given texts.
    struct Short;

    impl Embedder for Short {
        fn model_id(&self) -> &str {
            "short"
        }

        fn embed(&self, texts: &[String], _: Role) -> study_core::Result<Vec<Vec<f32>>> {
            Ok(vec![vec![1.0]; texts.len().saturating_sub(1)])
        }
    }

    async fn embed(slot: EmbedderSlot) -> Result<Option<JobTarget>, Failure> {
        let (_dir, store, _, document) = read_pdf();
        let job = queued(&store, JobKind::Embed, JobTarget::Document(document));
        EmbedStage::new(store, slot)
            .run(job, SourcePlan::default())
            .await
    }

    #[tokio::test]
    async fn vectors_that_do_not_match_the_passages_are_a_model_failure() {
        let failure = embed(EmbedderSlot::with(Arc::new(Short)))
            .await
            .unwrap_err();
        assert_eq!(failure.kind, ErrorKind::ModelUnavailable);
    }

    #[tokio::test]
    async fn without_the_search_model_embedding_passes_nothing_on() {
        let slot = EmbedderSlot::default();
        slot.turn_off();
        assert_eq!(embed(slot).await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_document_gone_before_indexing_passes_nothing_on() {
        let (_dir, store, source, document) = read_pdf();
        let job = queued(&store, JobKind::Index, JobTarget::Document(document));
        store
            .with(|database| database.delete_source(source))
            .unwrap();
        let passed = IndexStage::new(store)
            .run(job, SourcePlan::default())
            .await
            .unwrap();
        assert_eq!(passed, None);
    }
}
