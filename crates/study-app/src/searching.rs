//! Searching everything.

use study_core::Result;

use crate::App;
use crate::search::{SearchResults, Searcher};

impl App {
    /// The best `limit` results for `query`: names, then passages of what was read (keyword
    /// and, once the search model is installed, semantic matches), then messages. Blocks on
    /// the database and the model.
    pub fn search(&self, query: &str, limit: usize) -> Result<SearchResults> {
        Searcher::new(self.store()?.clone(), self.embedder().clone()).search(query, limit)
    }
}
