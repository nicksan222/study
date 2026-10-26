//! [`excerpts_of_sources`]: what was read from sources, as the [`Excerpt`]s an agent
//! reads, numbered in its prompt, and cites back.

use study_core::db::Database;
use study_core::processing::Excerpt;
use study_core::{Result, SourceId};

use super::passages::passages;

/// Every passage of what was read from each of `sources`, in their order, read from their
/// documents so they count even before they are indexed. A source that is gone or not read
/// yet adds nothing.
pub fn excerpts_of_sources(database: &Database, sources: &[SourceId]) -> Result<Vec<Excerpt>> {
    let mut excerpts = Vec::new();
    for &source in sources {
        let (Some(stored), Some((_, document))) =
            (database.source(source)?, database.document_of(source)?)
        else {
            continue;
        };
        excerpts.extend(passages(&document).into_iter().map(|passage| Excerpt {
            source_id: source,
            source_name: stored.name.clone(),
            anchor: passage.anchor,
            text: passage.text,
        }));
    }
    Ok(excerpts)
}
