//! Citations: the passages an answer, a piece of study material or a practice question cites
//! as `[marker]`.
//!
//! Message versions keep theirs in `citations`, artifacts in `artifact_citations` and practice
//! questions in `question_citations`; the tables have the same columns after the owner's id,
//! so one writer, one reader and one row mapper serve them all.
//! Each row snapshots the source's name, the place and the quote, so it still reads
//! correctly after the source is gone.

use super::json_column;
use crate::Result;
use crate::{ArtifactId, Citation, QuestionId, VersionId};
use rusqlite::{Connection, Row, params};

/// Whose citations these are, which picks the table.
#[derive(Clone, Copy, Debug)]
pub(super) enum CitedBy {
    Version(VersionId),
    Artifact(ArtifactId),
    Question(QuestionId),
}

impl CitedBy {
    /// The table and its owner column, and the owner's id.
    fn table(self) -> (&'static str, &'static str, i64) {
        match self {
            Self::Version(id) => ("citations", "version_id", id.get()),
            Self::Artifact(id) => ("artifact_citations", "artifact_id", id.get()),
            Self::Question(id) => ("question_citations", "question_id", id.get()),
        }
    }
}

/// The columns every citation table has after its owner's id, in the order
/// [`Citation::from_row`] maps them.
const CITATION_COLUMNS: &str = "marker, source_id, source_name, anchor, quote";

/// Replaces every citation of `owner` with `citations`, inside the caller's transaction.
pub(super) fn replace_citations(
    connection: &Connection,
    owner: CitedBy,
    citations: &[Citation],
) -> Result<()> {
    let (table, column, id) = owner.table();
    connection.execute(
        &format!("DELETE FROM {table} WHERE {column} = ?1"),
        params![id],
    )?;
    // The excerpts were read before a long model call, so a cited source may be gone by
    // now: it is stored as no source, like one deleted afterwards, rather than failing the
    // finished work on the foreign key.
    let mut insert = connection.prepare(&format!(
        "INSERT INTO {table} ({column}, {CITATION_COLUMNS})
         VALUES (?1, ?2, (SELECT id FROM sources WHERE id = ?3), ?4, ?5, ?6)"
    ))?;
    for citation in citations {
        insert.execute(params![
            id,
            citation.marker,
            citation.source_id,
            citation.source_name,
            serde_json::to_string(&citation.anchor)?,
            citation.quote
        ])?;
    }
    Ok(())
}

/// Every citation of `owner`, in marker order.
pub(super) fn citations_of(connection: &Connection, owner: CitedBy) -> Result<Vec<Citation>> {
    let (table, column, id) = owner.table();
    let citations = connection
        .prepare(&format!(
            "SELECT {CITATION_COLUMNS} FROM {table} WHERE {column} = ?1 ORDER BY marker"
        ))?
        .query_map(params![id], |row| Citation::from_row(row, 0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(citations)
}

impl Citation {
    /// Maps `marker, source_id, source_name, anchor, quote` ([`CITATION_COLUMNS`]) starting at
    /// `offset`.
    pub(super) fn from_row(row: &Row, offset: usize) -> rusqlite::Result<Self> {
        Ok(Citation {
            marker: row.get(offset)?,
            source_id: row.get(offset + 1)?,
            source_name: row.get(offset + 2)?,
            anchor: json_column(row, offset + 3)?,
            quote: row.get(offset + 4)?,
        })
    }
}
