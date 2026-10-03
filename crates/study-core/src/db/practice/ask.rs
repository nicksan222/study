//! Asking: getting a project's practice, keeping two questions ahead of the student, and storing a
//! question once its job has written it.

use super::super::citations::{CitedBy, replace_citations};
use super::super::jobs::{JobTarget, NewJob, enqueue, pending_questions_of, pending_reads_of};
use super::super::{Database, unix_timestamp};
use super::{UNANSWERED, practice_sources, question_state};
use crate::{
    Citation, ErrorKind, JobKind, PracticeId, ProjectId, QuestionId, QuestionKind, QuestionStatus,
    Result, WrittenQuestion, bail,
};
use rusqlite::{Connection, OptionalExtension as _, params};

/// How many questions a practice keeps waiting for the student: the one they read and the
/// next, written meanwhile.
pub(super) const AHEAD: u32 = 2;

impl Database {
    /// The project's practice: the one it already has, or a new one with its first questions
    /// and the jobs that write them, after the reads of the project's files still under way,
    /// in one transaction. A practice is never started over a set of sessions: it draws on
    /// the whole project, also what is added later.
    pub fn project_practice(&self, project: ProjectId) -> Result<PracticeId> {
        let tx = self.immediate()?;
        let existing: Option<PracticeId> = tx
            .query_row(
                "SELECT id FROM practices WHERE project_id = ?1",
                params![project],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Ok(id);
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM projects WHERE id = ?1)",
            params![project],
            |row| row.get(0),
        )?;
        if !exists {
            bail!(ErrorKind::NotFound, "project {project} does not exist");
        }
        let now = unix_timestamp();
        tx.execute(
            "INSERT INTO practices (project_id, created_at, updated_at) VALUES (?1, ?2, ?2)",
            params![project, now],
        )?;
        let id = PracticeId::new(tx.last_insert_rowid());
        top_up(&tx, id)?;
        tx.commit()?;
        Ok(id)
    }

    /// Marks a question as being written. Returns `false` when there is nothing to write:
    /// it is gone or already written. One left `writing` by an interrupted attempt counts
    /// as not yet written.
    pub fn begin_question(&self, id: QuestionId) -> Result<bool> {
        let changed = self.connection.execute(
            "UPDATE practice_questions SET status = 'writing'
             WHERE id = ?1 AND status IN ('pending', 'writing')",
            params![id],
        )?;
        Ok(changed != 0)
    }

    /// Stores a written question in both its forms and the passages it cites, ready to be
    /// answered, and tops its practice up to two unanswered questions, in one transaction.
    /// Fails with [`ErrorKind::InvalidInput`] on a question that fails
    /// [`WrittenQuestion::check`] or is of the other kind. Returns `false`, changing
    /// nothing, when the question is gone or was already written.
    pub fn finish_question(
        &self,
        id: QuestionId,
        written: &WrittenQuestion,
        citations: &[Citation],
    ) -> Result<bool> {
        let tx = self.immediate()?;
        let question = question_state(&tx, id)?;
        let Some((practice, kind, status)) = question else {
            return Ok(false);
        };
        if !matches!(status, QuestionStatus::Pending | QuestionStatus::Writing) {
            return Ok(false);
        }
        if written.body.kind() != kind {
            bail!(
                ErrorKind::InvalidInput,
                "a {} question written where a {kind} one was asked",
                written.body.kind()
            );
        }
        written.check()?;
        tx.execute(
            "UPDATE practice_questions SET status = 'ready', body = ?2, gist = ?3 WHERE id = ?1",
            params![
                id,
                serde_json::to_string(&written.body)?,
                written.gist.trim()
            ],
        )?;
        replace_citations(&tx, CitedBy::Question(id), citations)?;
        top_up(&tx, practice)?;
        tx.commit()?;
        Ok(true)
    }
}

/// Stores questions until `practice` has [`AHEAD`] waiting for the student, each with the
/// job that writes it, inside the caller's transaction. Each waits
/// for the reads of the practice's files still under way, and for the questions still being
/// written, so it is written from what was read and knows what was asked before it.
pub(super) fn top_up(tx: &Connection, practice: PracticeId) -> Result<()> {
    let unanswered: u32 = tx.query_row(
        &format!(
            "SELECT count(*) FROM practice_questions
             WHERE practice_id = ?1 AND status IN {UNANSWERED}"
        ),
        params![practice],
        |row| row.get(0),
    )?;
    for _ in unanswered..AHEAD {
        let ordinal: u32 = tx.query_row(
            "SELECT coalesce(max(ordinal) + 1, 0) FROM practice_questions WHERE practice_id = ?1",
            params![practice],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO practice_questions (practice_id, ordinal, kind, status, created_at)
             VALUES (?1, ?2, ?3, 'pending', ?4)",
            params![
                practice,
                ordinal,
                QuestionKind::for_ordinal(ordinal),
                unix_timestamp()
            ],
        )?;
        let question = QuestionId::new(tx.last_insert_rowid());
        let mut after = pending_reads_of(tx, &practice_sources(tx, practice)?)?;
        after.extend(pending_questions_of(tx, practice)?);
        enqueue(
            tx,
            &NewJob::new(JobKind::Question, JobTarget::Question(question)).after(after),
        )?;
    }
    Ok(())
}
