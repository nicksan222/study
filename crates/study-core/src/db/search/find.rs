//! Finding things by what was typed: passages by keyword (`chunks_fts`), messages by keyword
//! (`message_fts`, the active versions), and projects, sessions and sources by name. Results come back as
//! [`SearchHit`]s ready to show, or as passage ids for the caller to rank.

use super::super::{Database, json_column};
use super::{SearchHit, SearchKind, SearchTarget};
use crate::Result;
use crate::{ChunkId, ProjectId, SourceId};
use rusqlite::{OptionalExtension as _, params};
use std::collections::HashSet;

/// The latest session that has source `s` attached, if any.
const LATEST_SESSION: &str = "SELECT m.session_id FROM message_parts part
     JOIN messages m ON m.id = part.message_id
     WHERE part.source_id = s.id ORDER BY m.id DESC LIMIT 1";

impl Database {
    /// Passages containing every word of `query` (each as a prefix), best first.
    pub fn keyword_chunks(&self, query: &str, limit: usize) -> Result<Vec<ChunkId>> {
        let Some(expression) = fts_all_words(query) else {
            return Ok(Vec::new());
        };
        let mut statement = self.connection.prepare(
            "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?1
             ORDER BY bm25(chunks_fts) LIMIT ?2",
        )?;
        let ids = statement
            .query_map(params![expression, limit as i64], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ids)
    }

    /// Passages in `project` containing any word of `question` of three letters or more,
    /// best first: what an answer may draw on.
    pub fn passages_about(
        &self,
        question: &str,
        project: ProjectId,
        limit: usize,
    ) -> Result<Vec<ChunkId>> {
        let Some(expression) = fts_any_word(question) else {
            return Ok(Vec::new());
        };
        let mut statement = self.connection.prepare(
            "SELECT chunks_fts.rowid FROM chunks_fts
             JOIN chunks c ON c.id = chunks_fts.rowid
             JOIN documents d ON d.id = c.document_id
             JOIN sources s ON s.id = d.source_id
             WHERE chunks_fts MATCH ?1 AND s.project_id = ?2
             ORDER BY bm25(chunks_fts) LIMIT ?3",
        )?;
        let ids = statement
            .query_map(params![expression, project, limit as i64], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ids)
    }

    /// Results for ranked passages: the best passage of each source, in rank order. Passages
    /// whose source is gone are skipped.
    pub fn passage_hits(&self, chunks: &[ChunkId]) -> Result<Vec<SearchHit>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT s.id, s.name, p.name, c.anchor, c.text, ({LATEST_SESSION}), s.kind, s.created_at
             FROM chunks c
             JOIN documents d ON d.id = c.document_id
             JOIN sources s ON s.id = d.source_id
             LEFT JOIN projects p ON p.id = s.project_id
             WHERE c.id = ?1",
        ))?;
        let mut hits = Vec::new();
        let mut seen = HashSet::new();
        for &chunk in chunks {
            let hit = statement
                .query_row(params![chunk], |row| {
                    let source_id: SourceId = row.get(0)?;
                    let hit = SearchHit {
                        kind: SearchKind::Source,
                        title: row.get(1)?,
                        context: row.get(2)?,
                        excerpt: Some(row.get(4)?),
                        file_kind: Some(row.get(6)?),
                        at: row.get(7)?,
                        target: SearchTarget::Source {
                            source_id,
                            anchor: Some(json_column(row, 3)?),
                            session_id: row.get(5)?,
                        },
                    };
                    Ok((source_id, hit))
                })
                .optional()?;
            // Passages whose source is gone have no row.
            if let Some((source_id, hit)) = hit
                && seen.insert(source_id)
            {
                hits.push(hit);
            }
        }
        Ok(hits)
    }

    /// Projects, sessions and sources whose name contains `query`, in that order; at most
    /// `limit` in all.
    pub fn name_hits(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = contains_pattern(query);
        let mut hits = self.project_name_hits(&pattern, limit)?;
        hits.extend(self.session_name_hits(&pattern, limit)?);
        hits.extend(self.source_name_hits(&pattern, limit)?);
        hits.truncate(limit);
        Ok(hits)
    }

    /// Projects whose name matches the `LIKE` `pattern`, newest first.
    fn project_name_hits(&self, pattern: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, updated_at FROM projects WHERE name LIKE ?1 ESCAPE '\\'
             ORDER BY id DESC LIMIT ?2",
        )?;
        let hits = statement
            .query_map(params![pattern, limit as i64], |row| {
                Ok(SearchHit {
                    kind: SearchKind::Project,
                    title: row.get(1)?,
                    context: None,
                    excerpt: None,
                    file_kind: None,
                    at: row.get(2)?,
                    target: SearchTarget::Project(row.get(0)?),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(hits)
    }

    /// Sessions whose title matches the `LIKE` `pattern`, most recently used first.
    fn session_name_hits(&self, pattern: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut statement = self.connection.prepare(
            "SELECT s.id, s.title, p.id, p.name, s.updated_at FROM sessions s
             JOIN projects p ON p.id = s.project_id
             WHERE s.title LIKE ?1 ESCAPE '\\'
             ORDER BY s.updated_at DESC LIMIT ?2",
        )?;
        let hits = statement
            .query_map(params![pattern, limit as i64], |row| {
                Ok(SearchHit {
                    kind: SearchKind::Session,
                    title: row.get(1)?,
                    context: Some(row.get(3)?),
                    excerpt: None,
                    file_kind: None,
                    at: row.get(4)?,
                    target: SearchTarget::Session {
                        session_id: row.get(0)?,
                        project_id: row.get(2)?,
                    },
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(hits)
    }

    /// Sources whose name matches the `LIKE` `pattern`, newest first.
    fn source_name_hits(&self, pattern: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT s.id, s.name, p.name, ({LATEST_SESSION}), s.kind, s.created_at FROM sources s
             LEFT JOIN projects p ON p.id = s.project_id
             WHERE s.name LIKE ?1 ESCAPE '\\'
             ORDER BY s.id DESC LIMIT ?2",
        ))?;
        let hits = statement
            .query_map(params![pattern, limit as i64], |row| {
                Ok(SearchHit {
                    kind: SearchKind::Source,
                    title: row.get(1)?,
                    context: row.get(2)?,
                    excerpt: None,
                    file_kind: Some(row.get(4)?),
                    at: row.get(5)?,
                    target: SearchTarget::Source {
                        source_id: row.get(0)?,
                        anchor: None,
                        session_id: row.get(3)?,
                    },
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(hits)
    }

    /// Chat messages containing every word of `query`, best first.
    pub fn message_hits(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let Some(expression) = fts_all_words(query) else {
            return Ok(Vec::new());
        };
        let mut statement = self.connection.prepare(
            "SELECT v.text, s.id, s.title, p.id, p.name, m.created_at FROM message_fts
             JOIN message_versions v ON v.id = message_fts.rowid
             JOIN messages m ON m.id = v.message_id AND m.active_version_id = v.id
             JOIN sessions s ON s.id = m.session_id
             JOIN projects p ON p.id = s.project_id
             WHERE message_fts MATCH ?1
             ORDER BY bm25(message_fts) LIMIT ?2",
        )?;
        let hits = statement
            .query_map(params![expression, limit as i64], |row| {
                Ok(SearchHit {
                    kind: SearchKind::Message,
                    excerpt: Some(row.get(0)?),
                    title: row.get(2)?,
                    context: Some(row.get(4)?),
                    file_kind: None,
                    at: row.get(5)?,
                    target: SearchTarget::Session {
                        session_id: row.get(1)?,
                        project_id: row.get(3)?,
                    },
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(hits)
    }
}

/// An FTS5 query matching every word of `query` as a prefix, or `None` without words. Words
/// are quoted, so operators and punctuation typed by the user are never interpreted.
fn fts_all_words(query: &str) -> Option<String> {
    fts_terms(query, |word| !word.is_empty(), " ")
}

/// Any of the words of three letters or more, each as a prefix; shorter words are mostly
/// articles and prepositions that would match everything.
fn fts_any_word(question: &str) -> Option<String> {
    fts_terms(question, |word| word.chars().count() >= 3, " OR ")
}

/// The words of `text` that pass `keep`, each quoted as a prefix, joined by `separator`.
fn fts_terms(text: &str, keep: impl Fn(&str) -> bool, separator: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| keep(word))
        .map(|word| format!("\"{word}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(separator))
}

/// A `LIKE … ESCAPE '\'` pattern matching any text that contains `text` literally: its `%`,
/// `_` and `\` match only themselves.
fn contains_pattern(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

#[cfg(test)]
mod tests {
    use super::contains_pattern;

    #[test]
    fn a_contains_pattern_escapes_like_wildcards() {
        assert_eq!(contains_pattern("mito"), "%mito%");
        assert_eq!(contains_pattern(r"100%_a\b"), r"%100\%\_a\\b%");
    }
}
