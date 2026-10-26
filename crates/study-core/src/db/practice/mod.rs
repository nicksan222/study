//! Practice: an endless quiz over a whole project, one ongoing practice per project.
//!
//! A practice draws on everything in its project: its files and the notes of all its
//! sessions, also those added after it started ([`Database::practice_material`]). Its questions
//! come one at a time and never run out: whenever fewer than two wait for an answer, another
//! is stored with the [`JobKind::Question`](crate::JobKind::Question) job that writes it,
//! after the reads of the project's files and the questions still being written, so each
//! writer sees what was asked before. A choice is graded at once; an answer in the
//! student's own words queues a [`JobKind::Grade`](crate::JobKind::Grade) job, and a model
//! gives the verdict and says why.
//!
//! | File          | What it holds                                                        |
//! |---------------|----------------------------------------------------------------------|
//! | `mod.rs`      | The records, reading practices and questions, the material, deleting |
//! | `ask.rs`      | Getting a project's practice, keeping questions ahead, storing them  |
//! | `answer.rs`   | Answering a question, and storing an open answer's grade             |
//! | `mistakes.rs` | The practice's flashcard set of mistakes                             |

mod answer;
mod ask;
mod mistakes;
#[cfg(test)]
mod tests;

use super::citations::{CitedBy, citations_of};
use super::messages::{ProjectMaterial, project_material_of};
use super::{Database, Job, JobTarget, json_column};
use crate::{
    Citation, JobId, PracticeAnswer, PracticeId, ProjectId, QuestionId, QuestionKind,
    QuestionStatus, Result, SourceId, Verdict, WrittenQuestion,
};
use rusqlite::{Connection, OptionalExtension as _, Row, params};

/// Statuses of questions that still wait for the student, as an SQL list.
const UNANSWERED: &str = "('pending', 'writing', 'ready')";

/// The columns [`PracticeQuestion::from_row`] maps; add `WHERE`/`ORDER BY`.
const SELECT_QUESTION: &str = "SELECT id, practice_id, ordinal, kind, status, body, gist,
    choice, answer, verdict, feedback, created_at, answered_at, graded_at
    FROM practice_questions";

/// How a practice is going.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PracticeScore {
    /// Questions written so far.
    pub asked: u32,
    /// Questions the student answered, graded or not yet.
    pub answered: u32,
    pub correct: u32,
    pub partly: u32,
    pub incorrect: u32,
}

/// A practice in the list of practices.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PracticeSummary {
    pub id: PracticeId,
    /// The project it draws from, which names it.
    pub project_id: ProjectId,
    pub score: PracticeScore,
    pub created_at: i64,
    /// When it was started or last answered.
    pub updated_at: i64,
}

/// A practice with every question asked so far.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Practice {
    pub id: PracticeId,
    /// The project it draws from, which names it.
    pub project_id: ProjectId,
    pub score: PracticeScore,
    /// In the order they are asked; the unanswered ones last.
    pub questions: Vec<PracticeQuestion>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One question of a practice, with the student's answer and its grade once given.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PracticeQuestion {
    pub id: QuestionId,
    pub practice_id: PracticeId,
    /// Its place in the practice, counted from 0.
    pub ordinal: u32,
    pub kind: QuestionKind,
    pub status: QuestionStatus,
    /// Once written: what the student sees, and the gist later writers are shown.
    pub written: Option<WrittenQuestion>,
    /// Once answered.
    pub answer: Option<PracticeAnswer>,
    /// Once graded.
    pub verdict: Option<Verdict>,
    /// Why an open answer got its verdict; a choice's explanation is in its body.
    pub feedback: Option<String>,
    /// The passages the question rests on, by marker.
    pub citations: Vec<Citation>,
    /// The latest job on it, writing it or grading its answer, which says how that went.
    pub job: Option<Job>,
    pub created_at: i64,
    pub answered_at: Option<i64>,
    pub graded_at: Option<i64>,
}

/// What answering a question did.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Answered {
    /// A choice, graded at once.
    Graded(Verdict),
    /// An open answer, which this job grades.
    Grading(JobId),
}

impl Database {
    /// Every practice, the one started or answered last first.
    pub fn practices(&self) -> Result<Vec<PracticeSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, created_at, updated_at FROM practices
             ORDER BY updated_at DESC, id DESC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(PracticeSummary {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    score: PracticeScore::default(),
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut practices = Vec::with_capacity(rows.len());
        for mut practice in rows {
            practice.score = score_of(&self.connection, practice.id)?;
            practices.push(practice);
        }
        Ok(practices)
    }

    /// One practice with every question, with their citations and latest jobs.
    pub fn practice(&self, id: PracticeId) -> Result<Option<Practice>> {
        let Some((project_id, created_at, updated_at)) = self
            .connection
            .query_row(
                "SELECT project_id, created_at, updated_at FROM practices WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, ProjectId>(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
        else {
            return Ok(None);
        };
        let mut questions = self
            .connection
            .prepare(&format!(
                "{SELECT_QUESTION} WHERE practice_id = ?1 ORDER BY ordinal"
            ))?
            .query_map(params![id], PracticeQuestion::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut jobs = self.question_jobs_of(id)?;
        for question in &mut questions {
            question.citations = citations_of(&self.connection, CitedBy::Question(question.id))?;
            question.job = jobs.remove(&question.id);
        }
        Ok(Some(Practice {
            id,
            project_id,
            score: score_of(&self.connection, id)?,
            questions,
            created_at,
            updated_at,
        }))
    }

    /// One question with its citations and latest job.
    pub fn question(&self, id: QuestionId) -> Result<Option<PracticeQuestion>> {
        let Some(mut question) = self
            .connection
            .query_row(
                &format!("{SELECT_QUESTION} WHERE id = ?1"),
                params![id],
                PracticeQuestion::from_row,
            )
            .optional()?
        else {
            return Ok(None);
        };
        question.citations = citations_of(&self.connection, CitedBy::Question(id))?;
        question.job = self.jobs_for(JobTarget::Question(id))?.pop();
        Ok(Some(question))
    }

    /// The project practice `id` draws from; `None` when the practice is gone.
    pub fn practice_project(&self, id: PracticeId) -> Result<Option<ProjectId>> {
        project_of(&self.connection, id)
    }

    /// What `id`'s questions are written from: what its project holds now
    /// ([`Database::project_material`]); `None` when the practice is gone.
    pub fn practice_material(&self, id: PracticeId) -> Result<Option<ProjectMaterial>> {
        match project_of(&self.connection, id)? {
            Some(project) => project_material_of(&self.connection, project).map(Some),
            None => Ok(None),
        }
    }

    /// The gists of the latest `limit` written questions of `id`, oldest first, so the next
    /// one can be told not to repeat them. Only the short forms: a long practice's list stays
    /// a few hundred tokens.
    pub fn asked_questions(&self, id: PracticeId, limit: usize) -> Result<Vec<String>> {
        let mut asked: Vec<String> = self
            .connection
            .prepare(
                "SELECT gist FROM practice_questions
                 WHERE practice_id = ?1 AND gist IS NOT NULL
                 ORDER BY ordinal DESC LIMIT ?2",
            )?
            .query_map(params![id, limit as i64], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        asked.reverse();
        Ok(asked)
    }

    /// Deletes a practice with its questions and their jobs. Returns `false` when it was
    /// already gone.
    pub fn delete_practice(&self, id: PracticeId) -> Result<bool> {
        let changed = self
            .connection
            .execute("DELETE FROM practices WHERE id = ?1", params![id])?;
        Ok(changed != 0)
    }
}

/// Question `id`'s practice, kind and status, using the caller's transaction; `None` when
/// it is gone.
pub(super) fn question_state(
    connection: &Connection,
    id: QuestionId,
) -> Result<Option<(PracticeId, QuestionKind, QuestionStatus)>> {
    let state = connection
        .query_row(
            "SELECT practice_id, kind, status FROM practice_questions WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    Ok(state)
}

/// The project `practice` draws from, using the caller's transaction.
fn project_of(connection: &Connection, practice: PracticeId) -> Result<Option<ProjectId>> {
    Ok(connection
        .query_row(
            "SELECT project_id FROM practices WHERE id = ?1",
            params![practice],
            |row| row.get(0),
        )
        .optional()?)
}

/// Every file filed under `practice`'s project, none when it is gone, using the caller's transaction.
fn practice_sources(connection: &Connection, practice: PracticeId) -> Result<Vec<SourceId>> {
    match project_of(connection, practice)? {
        Some(project) => Ok(project_material_of(connection, project)?.sources),
        None => Ok(Vec::new()),
    }
}

/// How `practice` is going, using the caller's transaction.
fn score_of(connection: &Connection, practice: PracticeId) -> Result<PracticeScore> {
    // `count(column)` skips NULLs: a body means written, `answered_at` means answered.
    let score = connection.query_row(
        "SELECT count(body), count(answered_at),
             coalesce(sum(verdict = 'correct'), 0),
             coalesce(sum(verdict = 'partly'), 0),
             coalesce(sum(verdict = 'incorrect'), 0)
         FROM practice_questions WHERE practice_id = ?1",
        params![practice],
        |row| {
            Ok(PracticeScore {
                asked: row.get(0)?,
                answered: row.get(1)?,
                correct: row.get(2)?,
                partly: row.get(3)?,
                incorrect: row.get(4)?,
            })
        },
    )?;
    Ok(score)
}

impl PracticeQuestion {
    /// Maps a row of [`SELECT_QUESTION`].
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let written = match row.get::<_, Option<String>>(6)? {
            Some(gist) => Some(WrittenQuestion {
                gist,
                body: json_column(row, 5)?,
            }),
            None => None,
        };
        let choice: Option<u32> = row.get(7)?;
        let text: Option<String> = row.get(8)?;
        let answer = choice
            .map(PracticeAnswer::Choice)
            .or(text.map(PracticeAnswer::Open));
        Ok(PracticeQuestion {
            id: row.get(0)?,
            practice_id: row.get(1)?,
            ordinal: row.get(2)?,
            kind: row.get(3)?,
            status: row.get(4)?,
            written,
            answer,
            verdict: row.get(9)?,
            feedback: row.get(10)?,
            citations: Vec::new(),
            job: None,
            created_at: row.get(11)?,
            answered_at: row.get(12)?,
            graded_at: row.get(13)?,
        })
    }
}
