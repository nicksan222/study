//! What a project holds to study from: the files filed under it and the notes of all its
//! sessions. Study material and every question of a practice are written from it.

use super::super::Database;
use super::{MAX_NOTES_CHARS, MessageRole, PartKind, latest_notes};
use crate::{ProjectId, Result, SourceId, without_mention};
use rusqlite::{Connection, params};

/// What a project holds to study from.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProjectMaterial {
    /// Every file filed under the project, oldest first: a file moved to another project
    /// leaves this one, wherever it was attached.
    pub sources: Vec<SourceId>,
    /// The latest notes typed in the project's sessions that fit the budget, without their
    /// mentions, oldest first, one per line.
    pub notes: String,
}

impl Database {
    /// What `project` holds to study from, within the notes budget.
    pub fn project_material(&self, project: ProjectId) -> Result<ProjectMaterial> {
        project_material_of(&self.connection, project)
    }
}

/// What `project` holds to study from, using the caller's transaction.
pub(in crate::db) fn project_material_of(
    connection: &Connection,
    project: ProjectId,
) -> Result<ProjectMaterial> {
    let mut statement = connection.prepare(&format!(
        "SELECT p.text
         FROM message_parts p
         JOIN messages m ON m.id = p.message_id
         JOIN sessions s ON s.id = m.session_id
         WHERE s.project_id = ?1 AND p.kind = '{}' AND m.role = '{}'
         ORDER BY m.id, p.ordinal",
        PartKind::Text,
        MessageRole::User,
    ))?;
    // An answer's text is not a note: its `[n]` markers count another list of excerpts.
    let notes: Vec<String> = statement
        .query_map(params![project], |row| row.get::<_, Option<String>>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .map(|text| without_mention(&text))
        .filter(|text| !text.is_empty())
        .collect();
    let sources = connection
        .prepare("SELECT id FROM sources WHERE project_id = ?1 ORDER BY id")?
        .query_map(params![project], |row| row.get::<_, SourceId>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ProjectMaterial {
        sources,
        notes: latest_notes(&notes, MAX_NOTES_CHARS),
    })
}
