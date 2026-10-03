//! Answering: a choice is graded at once, an answer in the student's own words waits for
//! the job that grades it. Either way the practice gets its next question queued.

use super::super::jobs::{JobTarget, NewJob, enqueue};
use super::super::{Database, json_column, trimmed, unix_timestamp};
use super::Answered;
use super::ask::top_up;
use super::question_state;
use crate::{
    ErrorKind, JobKind, PracticeAnswer, PracticeBody, PracticeId, QuestionId, QuestionStatus,
    Result, Verdict, bail,
};
use rusqlite::{Connection, OptionalExtension as _, params};

/// Longest answer, or grading feedback, stored.
const MAX_TEXT_CHARS: usize = 20_000;

impl Database {
    /// Stores the student's answer to a ready question and tops its practice up to two
    /// unanswered questions, in one transaction. A choice gets its verdict at once; an open
    /// answer queues the [`JobKind::Grade`] job that grades it. Fails with
    /// [`ErrorKind::NotFound`] when the question is gone, and with
    /// [`ErrorKind::InvalidInput`] when it is not waiting for an answer, the answer is for
    /// the other kind, names no choice, or is empty.
    pub fn answer_question(&self, id: QuestionId, answer: &PracticeAnswer) -> Result<Answered> {
        let tx = self.immediate()?;
        let question = question_state(&tx, id)?;
        let Some((practice, kind, status)) = question else {
            bail!(ErrorKind::NotFound, "no question {id}");
        };
        if status != QuestionStatus::Ready {
            bail!(
                ErrorKind::InvalidInput,
                "question {id} is not waiting for an answer"
            );
        }
        if answer.kind() != kind {
            bail!(
                ErrorKind::InvalidInput,
                "a {} answer to a {kind} question",
                answer.kind()
            );
        }
        let now = unix_timestamp();
        let answered = match answer {
            PracticeAnswer::Choice(picked) => {
                let verdict = grade_choice(&tx, id, *picked)?;
                tx.execute(
                    "UPDATE practice_questions
                     SET status = 'graded', choice = ?2, verdict = ?3, answered_at = ?4,
                         graded_at = ?4
                     WHERE id = ?1",
                    params![id, picked, verdict, now],
                )?;
                Answered::Graded(verdict)
            }
            PracticeAnswer::Open(text) => {
                let text = trimmed(text, "answer", MAX_TEXT_CHARS)?;
                tx.execute(
                    "UPDATE practice_questions
                     SET status = 'answered', answer = ?2, answered_at = ?3
                     WHERE id = ?1",
                    params![id, text, now],
                )?;
                let job = enqueue(&tx, &NewJob::new(JobKind::Grade, JobTarget::Question(id)))?;
                Answered::Grading(job)
            }
        };
        touch(&tx, practice, now)?;
        top_up(&tx, practice)?;
        tx.commit()?;
        Ok(answered)
    }

    /// Whether an open answer waits for its grade. Nothing changes: it stays answered until
    /// [`finish_grade`](Self::finish_grade) stores the grade.
    pub fn begin_grade(&self, id: QuestionId) -> Result<bool> {
        let waiting = self
            .connection
            .query_row(
                "SELECT status = 'answered' FROM practice_questions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(waiting.unwrap_or(false))
    }

    /// Stores the grade of an open answer: its verdict and why. Returns `false` when there
    /// is no answer waiting for one.
    pub fn finish_grade(&self, id: QuestionId, verdict: Verdict, feedback: &str) -> Result<bool> {
        let feedback = trimmed(feedback, "feedback", MAX_TEXT_CHARS)?;
        let now = unix_timestamp();
        let tx = self.immediate()?;
        let practice: Option<PracticeId> = tx
            .query_row(
                "UPDATE practice_questions
                 SET status = 'graded', verdict = ?2, feedback = ?3, graded_at = ?4
                 WHERE id = ?1 AND status = 'answered'
                 RETURNING practice_id",
                params![id, verdict, feedback, now],
                |row| row.get(0),
            )
            .optional()?;
        let Some(practice) = practice else {
            return Ok(false);
        };
        touch(&tx, practice, now)?;
        tx.commit()?;
        Ok(true)
    }
}

/// Whether `picked` is the right choice of question `id`: its verdict.
fn grade_choice(tx: &Connection, id: QuestionId, picked: u32) -> Result<Verdict> {
    let body: PracticeBody = tx.query_row(
        "SELECT body FROM practice_questions WHERE id = ?1",
        params![id],
        |row| json_column(row, 0),
    )?;
    let PracticeBody::Choice {
        choices, answer, ..
    } = body
    else {
        bail!("choice question {id} holds another kind of body");
    };
    if picked as usize >= choices.len() {
        bail!(
            ErrorKind::InvalidInput,
            "question {id} has no choice {picked}"
        );
    }
    Ok(if picked == answer {
        Verdict::Correct
    } else {
        Verdict::Incorrect
    })
}

/// Marks `practice` as worked on at `now`, so it is listed first.
fn touch(tx: &Connection, practice: PracticeId, now: i64) -> Result<()> {
    tx.execute(
        "UPDATE practices SET updated_at = ?2 WHERE id = ?1",
        params![practice, now],
    )?;
    Ok(())
}
