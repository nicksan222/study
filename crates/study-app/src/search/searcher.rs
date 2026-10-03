//! Answering a query: names, then passages ranked by keyword and meaning together, then
//! chat messages. Matching by meaning scans every stored embedding of the search model: brute
//! force, with no vector index.

use study_core::Result;
use study_core::db::{SearchHit, Store};
use study_pipeline::EmbedderSlot;

use super::rank::{fuse, nearest};

/// Passages each ranking considers before they are fused.
const CANDIDATES: usize = 50;
/// Below this cosine similarity, a passage is not about the query at all. E5 rates even
/// unrelated text of the same language near 0.7, so the floor sits well above that.
const MIN_SIMILARITY: f32 = 0.80;

/// Results of one query.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SearchResults {
    /// Names first, then passages, then messages, at most the limit asked for.
    pub hits: Vec<SearchHit>,
    /// Whether meaning was matched too, not only words.
    pub semantic: bool,
}

/// Searches everything Study knows.
#[derive(Clone)]
pub struct Searcher {
    store: Store,
    embedder: EmbedderSlot,
}

impl Searcher {
    /// Searches `store`, matching meaning with the model in `embedder` once it is installed.
    pub fn new(store: Store, embedder: EmbedderSlot) -> Self {
        Self { store, embedder }
    }

    /// The best `limit` results for `query`: projects, sessions and files by name, passages
    /// of what was read from files (keyword and semantic matches fused), then messages.
    /// Blocks on the database and the model: call from a background thread.
    pub fn search(&self, query: &str, limit: usize) -> Result<SearchResults> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(SearchResults::default());
        }
        // Meaning is matched when the model works; words are matched regardless, so a model
        // that is not installed only means keyword search. The query is embedded before a
        // connection is taken, so the model's run holds none.
        let query_vector = self.embedder.embed_query(query);
        let mut hits = self.store.with(|database| {
            let mut hits = database.name_hits(query, limit)?;
            let keyword = database.keyword_chunks(query, CANDIDATES)?;
            let semantic = nearest(
                query_vector.as_ref(),
                CANDIDATES,
                MIN_SIMILARITY,
                |model, visit| database.for_each_embedding(model, visit),
            )?;
            hits.extend(database.passage_hits(&fuse(&[&keyword, &semantic]))?);
            hits.extend(database.message_hits(query, limit)?);
            Ok(hits)
        })?;
        hits.truncate(limit);
        Ok(SearchResults {
            hits,
            semantic: query_vector.is_some(),
        })
    }
}
