//! Study material of a project: notes, flashcards and diagrams.
//!
//! A piece of material is one project's one kind of it. It has at most one complete artifact,
//! the one the student sees, and at most one unfinished artifact, the update being written or
//! that failed. [`Database::request_update`] stores that update and queues the job that
//! writes it; the job revises the complete artifact, from all the project's files and
//! sessions' notes. The complete artifact stays as it was until the update is finished, which
//! replaces it in one transaction and carries over the flashcards the two share, so their
//! review history is not lost (see `cards.rs`). Nothing older is kept.
//!
//! [`Database::material_changes`] says how far the project has moved on since the complete
//! artifact was written. A practice's flashcard set of mistakes is not a piece of material.

use super::cards::{carry_cards, replace_cards};
use super::citations::{CitedBy, citations_of, replace_citations};
use super::jobs::{Job, JobTarget, NewJob, enqueue, pending_reads_of};
use super::messages::project_material_of;
use super::{Database, MAX_TITLE_CHARS, json_column, unix_timestamp};
use crate::processing::ProcessingPreferences;
use crate::text::truncate_chars;
use crate::{
    ArtifactBody, ArtifactId, ArtifactKind, ArtifactStatus, Citation, JobId, JobKind, PracticeId,
    ProjectId, SourceId,
};
use crate::{ErrorKind, Result, bail};
use rusqlite::{Connection, OptionalExtension as _, Row, params};
use std::collections::HashMap;

/// A stored artifact: a piece of material, or a practice's set of mistakes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Artifact {
    pub id: ArtifactId,
    pub project_id: ProjectId,
    pub kind: ArtifactKind,
    pub title: String,
    /// The project's notes as they were when it was asked for, latest ones kept, one per
    /// line.
    pub notes: String,
    pub status: ArtifactStatus,
    /// Once complete.
    pub body: Option<ArtifactBody>,
    /// The sources it is made from that still exist.
    pub sources: Vec<SourceId>,
    pub citations: Vec<Citation>,
    /// The latest job writing it, which says how writing went.
    pub job: Option<Job>,
    /// Whether it is a practice's set of mistakes rather than a piece of material.
    pub mistakes: bool,
    /// The practice whose mistakes it collects, while that practice exists; its cards come
    /// from that practice's questions, not from a job.
    pub practice_id: Option<PracticeId>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A piece of material: the project's one kind of it, or one practice's set of mistakes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Material {
    /// What the student sees: the complete artifact. `None` while the first is still being
    /// written, or failed.
    pub current: Option<Artifact>,
    /// The update: the artifact a job is writing, or failed to write. `current` stays shown
    /// meanwhile.
    pub update: Option<Artifact>,
}

/// How far a project has moved on since a piece of material was written.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Changes {
    /// Files added to the material the piece is written from, or gone from it.
    pub files: usize,
    /// Notes added, removed or edited (an edit counts as the old note gone and a new one
    /// added).
    pub notes: usize,
}

impl Changes {
    /// Whether nothing changed.
    pub fn is_none(&self) -> bool {
        self.files == 0 && self.notes == 0
    }
}

impl Database {
    /// Stores the update of the project's `kind` of material, made from `sources` and the
    /// notes of every session of the project, and queues the job that writes it after the
    /// reads of those sources still under way, in one transaction. While an update is
    /// pending or being written nothing new is stored or queued: that update is returned,
    /// with no job. When its job failed or was cancelled it is deleted, with the job, and
    /// asked again from the project as it is now.
    pub fn request_update(
        &self,
        project: ProjectId,
        kind: ArtifactKind,
        sources: &[SourceId],
    ) -> Result<(ArtifactId, Option<JobId>)> {
        let tx = self.immediate()?;
        let unfinished: Option<ArtifactId> = tx
            .query_row(
                "SELECT id FROM artifacts
                 WHERE project_id = ?1 AND kind = ?2 AND mistakes = 0 AND status != 'complete'",
                params![project, kind],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = unfinished {
            let ended: bool = tx
                .query_row(
                    "SELECT status IN ('failed', 'cancelled') FROM jobs
                     WHERE artifact_id = ?1 ORDER BY id DESC LIMIT 1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(false);
            if !ended {
                return Ok((id, None));
            }
            // Its job ended without writing it: drop it, with its job, and ask again from
            // the project as it is now.
            tx.execute("DELETE FROM artifacts WHERE id = ?1", params![id])?;
        }
        let held = project_material_of(&tx, project)?;
        if sources.is_empty() && held.notes.trim().is_empty() {
            bail!(
                ErrorKind::InvalidInput,
                "study material is made from a source or a session's notes"
            );
        }
        let name: String = tx
            .query_row(
                "SELECT name FROM projects WHERE id = ?1",
                params![project],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| crate::err!(ErrorKind::NotFound, "project {project} does not exist"))?;
        let now = unix_timestamp();
        tx.execute(
            "INSERT INTO artifacts (project_id, kind, title, notes, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5)",
            params![project, kind, material_title(&name)?, held.notes, now],
        )?;
        let id = ArtifactId::new(tx.last_insert_rowid());
        for source in sources {
            tx.execute(
                "INSERT OR IGNORE INTO artifact_sources (artifact_id, source_id) VALUES (?1, ?2)",
                params![id, source],
            )?;
        }
        let reads = pending_reads_of(&tx, sources)?;
        let job = enqueue(
            &tx,
            &NewJob::new(JobKind::Artifact, JobTarget::Artifact(id)).after(reads),
        )?;
        tx.commit()?;
        Ok((id, Some(job)))
    }

    /// A project's material, newest first: each kind it has, then each practice's set of
    /// mistakes.
    pub fn list_material(&self, project: ProjectId) -> Result<Vec<Material>> {
        let rows: Vec<(ArtifactId, ArtifactKind, bool, ArtifactStatus)> = self
            .connection
            .prepare(
                "SELECT id, kind, mistakes, status FROM artifacts
                 WHERE project_id = ?1 ORDER BY id DESC",
            )?
            .query_map(params![project], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        // Rows come newest first, so a piece is placed where its newest row is.
        let mut pieces: Vec<(Option<ArtifactKind>, Option<ArtifactId>, Option<ArtifactId>)> =
            Vec::new();
        for (id, kind, mistakes, status) in rows {
            let piece = (!mistakes).then_some(kind);
            let place = match piece {
                Some(_) => pieces.iter().position(|(other, ..)| *other == piece),
                None => None,
            };
            let place = place.unwrap_or_else(|| {
                pieces.push((piece, None, None));
                pieces.len() - 1
            });
            let slot = &mut pieces[place];
            if status == ArtifactStatus::Complete {
                slot.1 = Some(id);
            } else {
                slot.2 = Some(id);
            }
        }
        pieces
            .into_iter()
            .map(|(_, current, update)| {
                Ok(Material {
                    current: current.map(|id| self.artifact(id)).transpose()?.flatten(),
                    update: update.map(|id| self.artifact(id)).transpose()?.flatten(),
                })
            })
            .collect()
    }

    /// The one rule for what material can come from: the files of `project` that the plan
    /// in `processing` reads and whose plan offers `kind`. It goes by the plan alone, not
    /// by what has run, so what can be made is known before background work starts.
    pub fn sources_offering(
        &self,
        project: ProjectId,
        kind: ArtifactKind,
        processing: &ProcessingPreferences,
    ) -> Result<Vec<SourceId>> {
        Ok(self
            .list_sources()?
            .into_iter()
            .filter(|source| source.project_id == Some(project))
            .filter(|source| {
                let plan = processing.plan(source.kind, &source.mime);
                plan.reads() && plan.enhancers.contains(&kind)
            })
            .map(|source| source.id)
            .collect())
    }

    /// How far the project has moved on since material `id` was written: `offered` is what
    /// the project's files offer for its kind now (the caller knows the user's processing
    /// plan), set against the files it was made from, and the notes of the project's
    /// sessions now, set against its own. `None` when it is gone or is not material (a set
    /// of mistakes). Notes past the budget a piece reads (`MAX_NOTES_CHARS`) shift as the
    /// window moves, so the count is then approximate.
    pub fn material_changes(
        &self,
        id: ArtifactId,
        offered: &[SourceId],
    ) -> Result<Option<Changes>> {
        let Some((project, notes)) = self
            .connection
            .query_row(
                "SELECT project_id, notes FROM artifacts WHERE id = ?1 AND mistakes = 0",
                params![id],
                |row| Ok((row.get::<_, ProjectId>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        else {
            return Ok(None);
        };
        // A file deleted since leaves a row with no source, which counts as gone.
        let used: Vec<Option<SourceId>> = self
            .connection
            .prepare("SELECT source_id FROM artifact_sources WHERE artifact_id = ?1")?
            .query_map(params![id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let gone = used
            .iter()
            .filter(|source| source.is_none_or(|source| !offered.contains(&source)))
            .count();
        let added = offered
            .iter()
            .filter(|source| !used.contains(&Some(**source)))
            .count();
        let now = project_material_of(&self.connection, project)?.notes;
        Ok(Some(Changes {
            files: gone + added,
            notes: line_changes(&notes, &now),
        }))
    }

    /// One artifact with its sources, citations and latest job.
    pub fn artifact(&self, id: ArtifactId) -> Result<Option<Artifact>> {
        let Some(mut artifact) = self
            .connection
            .query_row(
                &format!("{SELECT_ARTIFACT} WHERE id = ?1"),
                params![id],
                Artifact::from_row,
            )
            .optional()?
        else {
            return Ok(None);
        };
        artifact.sources = sources_of(&self.connection, id)?;
        artifact.citations = citations_of(&self.connection, CitedBy::Artifact(id))?;
        artifact.job = self.jobs_for(JobTarget::Artifact(id))?.pop();
        Ok(Some(artifact))
    }

    /// The complete artifact of the same piece of material as `id`, if there is one besides
    /// `id`: what a writer revises.
    pub fn current_of(&self, id: ArtifactId) -> Result<Option<Artifact>> {
        let current: Option<ArtifactId> = self
            .connection
            .query_row(
                "SELECT c.id FROM artifacts a JOIN artifacts c
                     ON c.project_id = a.project_id AND c.kind = a.kind AND c.mistakes = 0
                 WHERE a.id = ?1 AND a.mistakes = 0 AND c.id != a.id AND c.status = 'complete'",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        match current {
            Some(current) => self.artifact(current),
            None => Ok(None),
        }
    }

    /// Marks an artifact as being written. A complete one is left alone, so its cards and
    /// their review history are never lost to a job run again. Returns `false` when there is
    /// nothing to write.
    pub fn begin_artifact(&self, id: ArtifactId) -> Result<bool> {
        let changed = self.connection.execute(
            "UPDATE artifacts SET status = 'writing', updated_at = ?2
             WHERE id = ?1 AND status != 'complete'",
            params![id, unix_timestamp()],
        )?;
        Ok(changed != 0)
    }

    /// Stores a finished artifact and the passages it cites in one transaction. The cards of
    /// a flashcard set are scheduled for review from now, except those that carry over from
    /// the complete artifact it replaces, which keep their memory; that one is then deleted
    /// with the cards that did not carry over. Returns `false` when it is gone.
    pub fn finish_artifact(
        &self,
        id: ArtifactId,
        body: &ArtifactBody,
        citations: &[Citation],
    ) -> Result<bool> {
        let now = unix_timestamp();
        let tx = self.immediate()?;
        let found: Option<(ProjectId, ArtifactKind, bool)> = tx
            .query_row(
                "SELECT project_id, kind, mistakes FROM artifacts WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((project, kind, mistakes)) = found else {
            return Ok(false);
        };
        if !body.fits(kind) {
            bail!("a {kind} artifact cannot hold this body");
        }
        let cards = match body {
            ArtifactBody::Flashcards { cards } => cards.as_slice(),
            _ => &[],
        };
        let replaced: Option<ArtifactId> = if mistakes {
            None
        } else {
            tx.query_row(
                "SELECT id FROM artifacts
                 WHERE project_id = ?1 AND kind = ?2 AND mistakes = 0
                   AND status = 'complete' AND id != ?3",
                params![project, kind, id],
                |row| row.get(0),
            )
            .optional()?
        };
        match replaced {
            Some(old) => {
                carry_cards(&tx, old, id, cards, now)?;
                // Its cards that did not carry over, and their reviews, go with it.
                tx.execute("DELETE FROM artifacts WHERE id = ?1", params![old])?;
            }
            None => replace_cards(&tx, id, cards, now)?,
        }
        tx.execute(
            "UPDATE artifacts SET status = 'complete', body = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, serde_json::to_string(body)?, now],
        )?;
        replace_citations(&tx, CitedBy::Artifact(id), citations)?;
        tx.commit()?;
        Ok(true)
    }

    /// Deletes the project's `kind` of material, the complete artifact and any update, with
    /// their cards and the cards' reviews. Returns `false` when there was none. A practice's
    /// set of mistakes is not a piece of material: see
    /// [`delete_artifact`](Self::delete_artifact).
    pub fn delete_material(&self, project: ProjectId, kind: ArtifactKind) -> Result<bool> {
        let changed = self.connection.execute(
            "DELETE FROM artifacts WHERE project_id = ?1 AND kind = ?2 AND mistakes = 0",
            params![project, kind],
        )?;
        Ok(changed != 0)
    }

    /// Deletes a practice's set of mistakes, with its cards and their reviews. Returns
    /// `false` when it was already gone, or is material, which only
    /// [`delete_material`](Self::delete_material) deletes.
    pub fn delete_artifact(&self, id: ArtifactId) -> Result<bool> {
        let changed = self.connection.execute(
            "DELETE FROM artifacts WHERE id = ?1 AND mistakes = 1",
            params![id],
        )?;
        Ok(changed != 0)
    }
}

/// How many lines differ between `before` and `now`: each line's count in one that the
/// other does not have, so an edited line counts twice.
fn line_changes(before: &str, now: &str) -> usize {
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for line in before.lines().filter(|line| !line.trim().is_empty()) {
        *counts.entry(line).or_default() += 1;
    }
    for line in now.lines().filter(|line| !line.trim().is_empty()) {
        *counts.entry(line).or_default() -= 1;
    }
    counts
        .values()
        .map(|count| count.unsigned_abs() as usize)
        .sum()
}

/// Stores `practice`'s empty flashcard set of mistakes in `project`, finished and titled
/// `title`, inside the caller's transaction. It needs no job: its cards come from the
/// practice's questions.
pub(super) fn insert_mistakes_set(
    tx: &Connection,
    project: ProjectId,
    practice: PracticeId,
    title: &str,
    now: i64,
) -> Result<ArtifactId> {
    tx.execute(
        "INSERT INTO artifacts
             (project_id, practice_id, kind, mistakes, title, status, body, created_at,
              updated_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?7)",
        params![
            project,
            practice,
            ArtifactKind::Flashcards,
            material_title(title)?,
            ArtifactStatus::Complete,
            serde_json::to_string(&ArtifactBody::Flashcards { cards: Vec::new() })?,
            now
        ],
    )?;
    Ok(ArtifactId::new(tx.last_insert_rowid()))
}

/// `title` trimmed and cut to [`MAX_TITLE_CHARS`] (one made from a long project name or
/// practice title still fits), refused as [`ErrorKind::InvalidInput`] when nothing is left.
fn material_title(title: &str) -> Result<&str> {
    let title = truncate_chars(title.trim(), MAX_TITLE_CHARS).trim_end();
    if title.is_empty() {
        bail!(ErrorKind::InvalidInput, "study material needs a title");
    }
    Ok(title)
}

/// The sources artifact `id` is made from that still exist.
fn sources_of(connection: &Connection, id: ArtifactId) -> Result<Vec<SourceId>> {
    let sources = connection
        .prepare(
            "SELECT source_id FROM artifact_sources
             WHERE artifact_id = ?1 AND source_id IS NOT NULL",
        )?
        .query_map(params![id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(sources)
}

/// An artifact's columns, as [`Artifact::from_row`] maps them; add `WHERE`.
const SELECT_ARTIFACT: &str = "SELECT id, project_id, kind, title, status, body, created_at,
        updated_at, notes, practice_id, mistakes
     FROM artifacts";

impl Artifact {
    /// Maps the columns of [`SELECT_ARTIFACT`], without sources, citations or job.
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let body = match row.get_ref(5)?.as_str_or_null()? {
            Some(_) => Some(json_column(row, 5)?),
            None => None,
        };
        Ok(Artifact {
            id: row.get(0)?,
            project_id: row.get(1)?,
            kind: row.get(2)?,
            title: row.get(3)?,
            notes: row.get(8)?,
            status: row.get(4)?,
            body,
            sources: Vec::new(),
            citations: Vec::new(),
            job: None,
            mistakes: row.get(10)?,
            practice_id: row.get(9)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::db::{Database, MessageRole, NewPart, Project, Source, read_nothing};
    use crate::{
        Anchor, ArtifactBody, ArtifactId, ArtifactKind, ArtifactStatus, Citation, JobKind,
        MessageId, Result,
    };
    use std::path::Path;

    /// A project, Biology, with one file in it, `cells.txt`.
    fn cells(db: &Database, dir: &Path) -> Result<(Project, Source)> {
        let project = db.create_project("Biology")?;
        let source = file(db, dir, &project, "cells.txt")?;
        Ok((project, source))
    }

    fn file(db: &Database, dir: &Path, project: &Project, name: &str) -> Result<Source> {
        let path = dir.join(name);
        std::fs::write(&path, name)?;
        db.import_source(&path, Some(project.id))
    }

    /// Writes a note in a new session of `project`.
    fn note(db: &Database, project: &Project, text: &str) -> Result<MessageId> {
        let session = db.create_session(project.id, "Lecture")?;
        let message = db.post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text(text.into())],
            &read_nothing,
        )?;
        Ok(message.id)
    }

    /// Finishes artifact `id` with a text body.
    fn finish(db: &Database, id: ArtifactId, text: &str) -> Result<()> {
        db.begin_artifact(id)?;
        db.finish_artifact(id, &ArtifactBody::Text { text: text.into() }, &[])?;
        Ok(())
    }

    #[test]
    fn material_is_made_from_a_source_or_a_note() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        assert!(
            db.request_update(project.id, ArtifactKind::Notes, &[])
                .is_err()
        );
        assert!(
            db.list_material(project.id)?.is_empty(),
            "nothing half-made"
        );

        note(&db, &project, "Cells burn sugar.")?;
        let (id, job) = db.request_update(project.id, ArtifactKind::Notes, &[])?;
        assert!(job.is_some());
        assert_eq!(db.artifact(id)?.unwrap().notes, "Cells burn sugar.");
        Ok(())
    }

    #[test]
    fn finishing_an_update_leaves_one_complete_piece_per_project_and_kind() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let other = db.create_project("History")?;
        let rome = file(&db, dir.path(), &other, "rome.txt")?;

        let mut ids = Vec::new();
        for text in ["one", "two", "three"] {
            let (id, job) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
            assert!(job.is_some());
            finish(&db, id, text)?;
            ids.push(id);
        }
        let (cards, _) = db.request_update(project.id, ArtifactKind::Flashcards, &[source.id])?;
        db.request_update(other.id, ArtifactKind::Notes, &[rome.id])?;

        // Each update replaced the one before: only the last is left.
        assert!(db.artifact(ids[0])?.is_none() && db.artifact(ids[1])?.is_none());
        let kept = db.artifact(ids[2])?.unwrap();
        assert_eq!(
            kept.body,
            Some(ArtifactBody::Text {
                text: "three".into()
            })
        );
        let complete: i64 = db.connection.query_row(
            "SELECT count(*) FROM artifacts
             WHERE project_id = ?1 AND kind = 'notes' AND status = 'complete'",
            [project.id],
            |row| row.get(0),
        )?;
        assert_eq!(complete, 1);

        // The pieces of the project, newest first: flashcards (not made yet) then the notes.
        let shown: Vec<_> = db
            .list_material(project.id)?
            .iter()
            .map(|piece| {
                (
                    piece.current.as_ref().map(|artifact| artifact.id),
                    piece.update.as_ref().map(|artifact| artifact.id),
                )
            })
            .collect();
        assert_eq!(shown, [(None, Some(cards)), (Some(ids[2]), None)]);
        Ok(())
    }

    #[test]
    fn an_unfinished_update_leaves_the_current_piece_shown() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (first, _) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        let pieces = |db: &Database| db.list_material(project.id);
        let made = &pieces(&db)?[0];
        assert!(made.current.is_none(), "nothing written yet");
        assert_eq!(made.update.as_ref().map(|update| update.id), Some(first));
        finish(&db, first, "one")?;
        let (second, _) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;

        let piece = &pieces(&db)?[0];
        assert_eq!(piece.update.as_ref().map(|update| update.id), Some(second));
        assert_eq!(
            piece
                .current
                .as_ref()
                .map(|current| (current.id, current.body.clone())),
            Some((first, Some(ArtifactBody::Text { text: "one".into() })))
        );
        assert_eq!(
            db.current_of(second)?.map(|current| current.id),
            Some(first),
            "what the writer revises"
        );
        finish(&db, second, "two")?;
        let piece = &pieces(&db)?[0];
        assert!(piece.update.is_none());
        assert_eq!(
            piece.current.as_ref().map(|current| current.id),
            Some(second)
        );
        Ok(())
    }

    #[test]
    fn a_failed_update_keeps_the_current_piece_visible() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (first, first_job) =
            db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        assert_eq!(
            db.claim_job(&[JobKind::Artifact])?.unwrap().id,
            first_job.unwrap()
        );
        finish(&db, first, "one")?;
        let (second, job) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        let job = job.unwrap();
        assert_eq!(db.claim_job(&[JobKind::Artifact])?.unwrap().id, job);
        db.begin_artifact(second)?;
        let failure = crate::Failure::new(crate::ErrorKind::Internal, "the writer broke");
        assert!(db.fail_job(job, &failure, None)?);

        let piece = &db.list_material(project.id)?[0];
        assert_eq!(
            piece.current.as_ref().map(|current| current.id),
            Some(first)
        );
        let update = piece.update.as_ref().unwrap();
        assert_eq!(update.id, second);
        assert!(update.job.as_ref().unwrap().status.is_stopped());
        assert!(db.artifact(first)?.unwrap().body.is_some());
        Ok(())
    }

    #[test]
    fn only_a_set_of_mistakes_is_deleted_by_itself_and_only_material_has_changes() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (id, _) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        finish(&db, id, "one")?;

        assert!(!db.delete_artifact(id)?, "material goes with its piece");
        assert!(db.artifact(id)?.is_some());
        assert!(db.material_changes(id, &[source.id])?.is_some());
        assert!(db.delete_material(project.id, ArtifactKind::Notes)?);
        Ok(())
    }

    #[test]
    fn asking_while_the_update_failed_starts_over_from_the_project_as_it_is_now() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (id, job) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        let job = job.unwrap();
        assert_eq!(db.claim_job(&[JobKind::Artifact])?.unwrap().id, job);
        db.begin_artifact(id)?;
        let failure = crate::Failure::new(crate::ErrorKind::Internal, "the writer broke");
        assert!(db.fail_job(job, &failure, None)?);

        // A file filed meanwhile is in the new attempt.
        let extra = dir.path().join("genetics.txt");
        std::fs::write(&extra, "alleles")?;
        let added = db.import_source(&extra, Some(project.id))?;
        let (again, queued) =
            db.request_update(project.id, ArtifactKind::Notes, &[source.id, added.id])?;
        assert_ne!(again, id, "the failed attempt is gone");
        assert!(queued.is_some_and(|queued| queued != job));
        assert!(db.artifact(id)?.is_none());
        assert!(db.job(job)?.is_none(), "with its job");
        let mut held = db.artifact(again)?.unwrap().sources;
        held.sort();
        let mut expected = vec![source.id, added.id];
        expected.sort();
        assert_eq!(held, expected);
        // Asked again meanwhile, nothing more is queued.
        assert_eq!(
            db.request_update(project.id, ArtifactKind::Notes, &[source.id])?,
            (again, None)
        );
        Ok(())
    }

    #[test]
    fn finishing_an_update_whose_piece_was_deleted_does_nothing() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (id, job) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        assert_eq!(
            db.claim_job(&[JobKind::Artifact])?.unwrap().id,
            job.unwrap()
        );
        db.begin_artifact(id)?;
        assert!(db.delete_material(project.id, ArtifactKind::Notes)?);
        assert!(!db.finish_artifact(
            id,
            &ArtifactBody::Text {
                text: "late".into()
            },
            &[]
        )?);
        assert!(db.artifact(id)?.is_none());
        Ok(())
    }

    #[test]
    fn asking_while_an_update_is_unfinished_queues_nothing_more() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (id, job) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        assert!(job.is_some());

        assert_eq!(
            db.request_update(project.id, ArtifactKind::Notes, &[source.id])?,
            (id, None)
        );
        db.begin_artifact(id)?;
        assert_eq!(
            db.request_update(project.id, ArtifactKind::Notes, &[source.id])?,
            (id, None),
            "being written"
        );
        let jobs = db
            .list_job_overviews(50)?
            .iter()
            .filter(|overview| overview.job.kind == JobKind::Artifact)
            .count();
        assert_eq!(jobs, 1);

        finish(&db, id, "done")?;
        let (next, job) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        assert_ne!(next, id, "a finished piece is updated by a new row");
        assert!(job.is_some());
        Ok(())
    }

    #[test]
    fn an_update_covers_every_session_of_the_project_and_outlives_them() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        note(&db, &project, "First lecture.")?;
        let session = db.create_session(project.id, "Second")?;
        db.post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("Second lecture. @study".into())],
            &read_nothing,
        )?;

        let held = db.project_material(project.id)?;
        assert_eq!(held.sources, [source.id]);
        assert_eq!(held.notes, "First lecture.\nSecond lecture.");

        let (id, _) = db.request_update(project.id, ArtifactKind::Notes, &held.sources)?;
        finish(&db, id, "notes")?;
        let made = db.artifact(id)?.unwrap();
        assert_eq!(made.notes, held.notes);
        assert_eq!(made.sources, [source.id]);

        // Deleting a session keeps the piece, whole.
        assert!(db.delete_session(session.id)?);
        let kept = db.artifact(id)?.unwrap();
        assert_eq!(
            (kept.status, kept.notes),
            (ArtifactStatus::Complete, held.notes)
        );
        Ok(())
    }

    #[test]
    fn changes_are_zero_right_after_an_update_and_count_what_moved_since() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, cells) = cells(&db, dir.path())?;
        let kept = note(&db, &project, "Cells burn sugar.")?;
        let edited = note(&db, &project, "Mitochondria make ATP.")?;
        let (id, _) = db.request_update(project.id, ArtifactKind::Notes, &[cells.id])?;
        finish(&db, id, "notes")?;
        let changes = |offered: &[crate::SourceId]| db.material_changes(id, offered);
        assert!(changes(&[cells.id])?.unwrap().is_none(), "up to date");

        // A file the project offers now, filed into it after the piece was written.
        let elsewhere = db.import_source(
            &{
                let path = dir.path().join("later.txt");
                std::fs::write(&path, "later")?;
                path
            },
            None,
        )?;
        db.set_source_project(elsewhere.id, Some(project.id))?;
        let c = changes(&[cells.id, elsewhere.id])?.unwrap();
        assert_eq!((c.files, c.notes), (1, 0));

        // A note edited counts as one gone and one added.
        db.connection.execute(
            "UPDATE message_parts SET text = 'Mitochondria make most ATP.'
             WHERE message_id = ?1",
            [edited],
        )?;
        let c = changes(&[cells.id, elsewhere.id])?.unwrap();
        assert_eq!((c.files, c.notes), (1, 2));

        // A note deleted counts, whatever its date.
        assert!(db.delete_message(kept)?);
        let c = changes(&[cells.id, elsewhere.id])?.unwrap();
        assert_eq!(c.notes, 3);

        // A file removed from the project, or no longer offered, counts too.
        let c = changes(&[])?.unwrap();
        assert_eq!(c.files, 1, "no longer offered");
        db.delete_source(cells.id)?;
        let c = changes(&[elsewhere.id])?.unwrap();
        assert_eq!(c.files, 2, "one gone, one not yet used: {c:?}");
        assert_eq!(db.material_changes(ArtifactId::new(9_999), &[])?, None);
        Ok(())
    }

    #[test]
    fn a_finished_artifact_keeps_its_citations_after_its_source_is_deleted() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (id, _) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        let pending = db.artifact(id)?.unwrap();
        assert_eq!(
            (pending.title.as_str(), pending.status, pending.body),
            ("Biology", ArtifactStatus::Pending, None)
        );

        let citation = Citation {
            marker: 1,
            source_id: Some(source.id),
            source_name: "cells.txt".into(),
            anchor: Anchor::Page { page: 1 },
            quote: "mitochondria".into(),
        };
        let body = ArtifactBody::Text {
            text: "Cells burn sugar [1].".into(),
        };
        assert!(db.begin_artifact(id)?);
        assert!(db.finish_artifact(id, &body, std::slice::from_ref(&citation))?);
        let done = db.artifact(id)?.unwrap();
        assert_eq!(done.status, ArtifactStatus::Complete);
        assert_eq!(done.citations, std::slice::from_ref(&citation));

        db.delete_source(source.id)?;
        let orphaned = db.artifact(id)?.unwrap();
        assert!(orphaned.sources.is_empty());
        assert_eq!(orphaned.citations[0].source_id, None);
        assert_eq!(orphaned.citations[0].quote, citation.quote);

        assert!(db.delete_material(project.id, ArtifactKind::Notes)?);
        assert!(!db.finish_artifact(id, &body, &[])?, "gone");
        assert!(!db.delete_material(project.id, ArtifactKind::Notes)?);
        Ok(())
    }

    #[test]
    fn deleting_a_project_deletes_its_material_and_cards() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let (project, source) = cells(&db, dir.path())?;
        let (id, _) = db.request_update(project.id, ArtifactKind::Notes, &[source.id])?;
        finish(&db, id, "x")?;
        assert!(db.delete_project(project.id)?);
        assert!(db.artifact(id)?.is_none());
        Ok(())
    }
}
