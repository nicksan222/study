//! Search end to end on a real database: passages indexed and embedded by their jobs, with a
//! stand-in model.

mod common;

use std::sync::Arc;

use study_ai::embed::{Embedder, Role};
use study_app::pipeline::{EmbedStage, EmbedderSlot, IndexStage, StageHandler};
use study_app::search::Searcher;
use study_app::views::{Anchor, Block, BlockKind, Document, DocumentMeta};
use study_core::Result;
use study_core::db::{
    Job, JobTarget, MessageRole, NewJob, NewPart, SearchKind, SearchTarget, Store, read_nothing,
};
use study_core::jobs::JobHandler;
use study_core::{DocumentId, JobKind};

/// Embeds by topic: texts about energy point one way, everything else another.
struct Topics;

impl Embedder for Topics {
    fn model_id(&self) -> &str {
        "topics"
    }

    fn embed(&self, texts: &[String], _role: Role) -> Result<Vec<Vec<f32>>> {
        Ok(texts
            .iter()
            .map(|text| {
                let text = text.to_lowercase();
                if ["energy", "atp", "powerhouse"]
                    .iter()
                    .any(|w| text.contains(w))
                {
                    vec![1.0, 0.0]
                } else {
                    vec![0.0, 1.0]
                }
            })
            .collect())
    }
}

/// A PDF-like source whose pages say `pages`, indexed and embedded by the real jobs.
async fn indexed(
    store: &Store,
    dir: &tempfile::TempDir,
    embedder: &EmbedderSlot,
    pages: &[&str],
) -> Result<DocumentId> {
    let path = common::write(dir, "cells.pdf", "%PDF-1.7")?;
    let document = Document {
        blocks: pages
            .iter()
            .enumerate()
            .map(|(index, text)| Block {
                kind: BlockKind::Paragraph,
                text: (*text).to_owned(),
                anchor: Anchor::Page {
                    page: index as u32 + 1,
                },
            })
            .collect(),
        meta: DocumentMeta {
            extractor: Some(study_core::processing::ExtractorKind::Vision),
            ..DocumentMeta::default()
        },
    };
    let id = store.with(|database| {
        let source = database.import_source(&path, None)?;
        database.save_document(source.id, &document)
    })?;
    for (kind, handler) in [
        (
            JobKind::Index,
            StageHandler::new(store.clone(), Arc::new(IndexStage::new(store.clone()))),
        ),
        (
            JobKind::Embed,
            StageHandler::new(
                store.clone(),
                Arc::new(EmbedStage::new(store.clone(), embedder.clone())),
            ),
        ),
    ] {
        let job_id = store
            .with(|database| database.enqueue_job(&NewJob::new(kind, JobTarget::Document(id))))?;
        let job: Job = store.with(|database| database.job(job_id))?.unwrap();
        handler
            .run(job)
            .await
            .map_err(|failure| study_core::err!(failure))?;
    }
    Ok(id)
}

#[tokio::test(flavor = "multi_thread")]
async fn finds_passages_by_keyword_and_by_meaning_at_their_page() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = common::store(&dir)?;
    let embedder = EmbedderSlot::with(Arc::new(Topics));
    indexed(
        &store,
        &dir,
        &embedder,
        &[
            "Mitochondria are the powerhouse of the cell",
            "Ribosomes build proteins",
        ],
    )
    .await?;
    let searcher = Searcher::new(store, embedder);

    let by_word = searcher.search("ribosomes", 10)?;
    assert!(by_word.semantic);
    let passage = &by_word.hits[0];
    assert_eq!(passage.kind, SearchKind::Source);
    assert!(matches!(
        passage.target,
        SearchTarget::Source {
            anchor: Some(Anchor::Page { page: 2 }),
            ..
        }
    ));

    // "energy" appears nowhere, but means the same as "powerhouse" to the model.
    let by_meaning = searcher.search("energy", 10)?;
    assert_eq!(by_meaning.hits.len(), 1);
    assert!(matches!(
        by_meaning.hits[0].target,
        SearchTarget::Source {
            anchor: Some(Anchor::Page { page: 1 }),
            ..
        }
    ));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn without_a_model_search_is_keyword_only() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = common::store(&dir)?;
    store.with(|database| database.create_project("Chemistry"))?;
    // An empty slot loads the installed model, if any; none is installed in a fresh test.
    let searcher = Searcher::new(store, EmbedderSlot::default());
    let results = searcher.search("chem", 10)?;
    assert_eq!(results.hits[0].title, "Chemistry");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn names_come_before_messages_and_the_limit_cuts_the_rest() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = common::store(&dir)?;
    store.with(|database| {
        let project = database.create_project("Mitosis")?;
        let session = database.create_session(project.id, "Mitosis lab")?;
        database.post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("Mitosis splits one cell into two".into())],
            &read_nothing,
        )?;
        Ok(())
    })?;
    let searcher = Searcher::new(store, EmbedderSlot::default());

    let kinds = |limit| -> Result<Vec<SearchKind>> {
        let hits = searcher.search("mitosis", limit)?.hits;
        Ok(hits.iter().map(|hit| hit.kind).collect())
    };
    assert_eq!(
        kinds(10)?,
        [
            SearchKind::Project,
            SearchKind::Session,
            SearchKind::Message
        ]
    );
    assert_eq!(kinds(2)?, [SearchKind::Project, SearchKind::Session]);
    Ok(())
}
