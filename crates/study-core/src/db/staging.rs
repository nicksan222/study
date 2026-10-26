//! Writes that put a database in a state the running app cannot reach by itself, such as a
//! message sent days ago or a job that failed an hour ago, for the sample data and tests
//! behind the `testing` feature. Each is one narrow statement: the schema stays in this
//! crate, and nothing here is a way to run other SQL.

use rusqlite::params;

use super::Database;
use crate::{
    ArtifactId, ErrorKind, JobId, JobStatus, MessageId, PracticeId, ProjectId, Result, SessionId,
    SourceId, SourceKind,
};

impl Database {
    /// Sets the exam of project `id` to `days` days from today, which no caller of
    /// [`set_exam`](Self::set_exam) can name without a calendar; the sample's exams are
    /// relative to the day it is written.
    pub fn set_exam_in_days(&self, id: ProjectId, days: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE projects SET exam_on = date('now', ?1) WHERE id = ?2",
            params![format!("+{days} days"), id],
        )?;
        Ok(())
    }

    /// Makes source `id`, imported from a file, an article saved from the web: named for its
    /// page `title` and opening at `url`, the way saving one leaves it.
    pub fn mark_saved_from_web(&self, id: SourceId, title: &str, url: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE sources SET name = ?1, kind = ?2, mime = 'text/html', origin = 'web',
                 uri = ?3
             WHERE id = ?4",
            params![title, SourceKind::Web, url, id],
        )?;
        Ok(())
    }

    /// Dates message `id` as sent at `at` (seconds since the epoch), so a session reads as
    /// days old.
    pub fn date_message(&self, id: MessageId, at: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE messages SET created_at = ?1 WHERE id = ?2",
            params![at, id],
        )?;
        Ok(())
    }

    /// Dates session `id` as started and last active at `at`, so it sorts where an old one
    /// would.
    pub fn date_session(&self, id: SessionId, at: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE sessions SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![at, id],
        )?;
        Ok(())
    }

    /// Dates artifact `id` as made at `at`.
    pub fn date_artifact(&self, id: ArtifactId, at: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE artifacts SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![at, id],
        )?;
        Ok(())
    }

    /// Marks job `id` as ended with `status` after one attempt that ran from `started` to
    /// `finished`, with `failure` when it failed, without running it.
    pub fn settle_job(
        &self,
        id: JobId,
        status: JobStatus,
        failure: Option<(ErrorKind, &str)>,
        started: i64,
        finished: i64,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE jobs
             SET status = ?1, attempts = 1, error_kind = ?2, error = ?3,
                 created_at = ?4, started_at = ?4, finished_at = ?5, updated_at = ?5
             WHERE id = ?6",
            params![
                status,
                failure.map(|(kind, _)| kind),
                failure.map(|(_, error)| error),
                started,
                finished,
                id
            ],
        )?;
        Ok(())
    }

    /// Marks every job that writes or grades a question of `practice` as succeeded at `at`,
    /// so a quiz written without a model has no work waiting.
    pub fn settle_practice_jobs(&self, practice: PracticeId, at: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE jobs SET status = ?1, attempts = 1, started_at = ?2, finished_at = ?2,
                 updated_at = ?2
             WHERE question_id IN (SELECT id FROM practice_questions WHERE practice_id = ?3)",
            params![JobStatus::Succeeded, at, practice],
        )?;
        Ok(())
    }
}
