//! Finding what an answer may draw on: every passage read from the files of the session
//! it answers in (transcripts, recognized text, pages), and then the passages of the rest
//! of the project most related to the question.

use study_core::Result;
use study_core::db::{Database, Store};
use study_core::processing::{Excerpt, fit_excerpts};
use study_core::{ProjectId, SourceId};
use study_pipeline::{EmbedderSlot, QueryVector, excerpts_of_sources};

use super::rank::{fuse, nearest};

/// Passages each ranking considers before they are fused.
const CANDIDATES: usize = 30;
/// Below this cosine similarity, a passage is not about the question. A little below
/// search's floor, as a loosely related passage still helps an answer; E5 rates even
/// unrelated text near 0.7.
const MIN_SIMILARITY: f32 = 0.78;

/// Retrieves passages for questions. Clones share the embedder.
#[derive(Clone)]
pub struct Retriever {
    store: Store,
    embedder: EmbedderSlot,
}

impl Retriever {
    /// Retrieves from `store`, matching meaning with the model in `embedder` once installed.
    pub fn new(store: Store, embedder: EmbedderSlot) -> Self {
        Self { store, embedder }
    }

    /// Passages for `question` from `project`. First every passage of the files in
    /// `files`, read from their documents so they count even before they are indexed,
    /// [fitted](fit_excerpts) within `budget` characters preferring those most related to
    /// the question, in their files' order. Then at most
    /// `extra` passages of other files matching the question's words and meaning, fused.
    /// Without the search model only words are matched. Blocks on the database and the
    /// model: call from a blocking context.
    pub fn retrieve(
        &self,
        question: &str,
        project: ProjectId,
        files: &[SourceId],
        budget: usize,
        extra: usize,
    ) -> Result<Vec<Excerpt>> {
        // Meaning is matched when the model works; words are matched regardless.
        let query = self.embedder.embed_query(question);
        self.store.with(|database| {
            let read = excerpts_of_sources(database, files)?;
            let related = related(database, question, query.as_ref(), project)?;
            let mut excerpts = fit_excerpts(read, budget, &related);
            let others = related
                .into_iter()
                .filter(|excerpt| !files.contains(&excerpt.source_id))
                .take(extra);
            excerpts.extend(others);
            Ok(excerpts)
        })
    }
}

/// The passages of `project` most related to `question`: those matching its words and, with
/// a `query` vector, its meaning, fused, best first.
fn related(
    database: &Database,
    question: &str,
    query: Option<&QueryVector>,
    project: ProjectId,
) -> Result<Vec<Excerpt>> {
    let keyword = database.passages_about(question, project, CANDIDATES)?;
    let semantic = nearest(query, CANDIDATES, MIN_SIMILARITY, |model, visit| {
        database.for_each_embedding_in(model, project, visit)
    })?;
    database.passages(&fuse(&[&keyword, &semantic]))
}
