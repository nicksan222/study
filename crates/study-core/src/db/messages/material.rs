//! What a project holds to study from: the files filed under it and the notes of all its
//! sessions. Study material and every question of a practice are written from it.

use super::super::Database;
use super::{MAX_NOTES_CHARS, MessageRole, latest_notes};
use crate::{ProjectId, Result, SourceId, without_citations, without_mention};
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
    // What the student wrote is the active version of a note: an edit replaces the words it
    // was written with, and a version still being written is not read.
    let mut statement = connection.prepare(&format!(
        "SELECT v.text, (SELECT group_concat(c.marker) FROM citations c WHERE c.version_id = v.id)
         FROM messages m
         JOIN message_versions v ON v.id = m.active_version_id
         JOIN sessions s ON s.id = m.session_id
         WHERE s.project_id = ?1 AND m.role = '{}'
         ORDER BY m.id",
        MessageRole::User,
    ))?;
    // A rewrite of a note may cite the files it read; its `[n]` markers count a list the
    // notes do not carry.
    let notes: Vec<String> = statement
        .query_map(params![project], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|(text, markers)| {
            let cited: Vec<u32> = markers
                .iter()
                .flat_map(|markers| markers.split(','))
                .filter_map(|marker| marker.parse().ok())
                .collect();
            without_citations(&without_mention(&text), &cited)
        })
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
