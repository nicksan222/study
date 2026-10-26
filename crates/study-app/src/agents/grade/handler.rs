//! Runs [`Grader`] as the `Grade` job: once the student answers an open question, and again
//! whenever the user retries.

use study_ai::agent::AgentRuntime;
use study_core::db::{Database, Job, NewJob};
use study_core::jobs::{BoxFuture, JobHandler, Lane, wrong_target};
use study_core::{Failure, JobKind, PracticeAnswer, PracticeBody, QuestionId, bail};

use super::{Grader, Submission};

/// Grades answers to open practice questions.
pub struct GradeHandler {
    runtime: AgentRuntime,
}

impl GradeHandler {
    /// Runs [`Grader`] on `runtime`.
    pub fn new(runtime: AgentRuntime) -> Self {
        Self { runtime }
    }

    /// Grades the answer to question `id`, unless it is graded or gone.
    async fn grade(&self, id: QuestionId) -> Result<(), Failure> {
        // Before any work: without a model there is nothing to grade with.
        let agent = self.runtime.required::<Grader>().await?;
        let submission = self
            .runtime
            .blocking(move |database| submission(database, id))
            .await?;
        let Some(submission) = submission else {
            return Ok(());
        };
        let grade = agent.run(&submission).await.map_err(Failure::from)?;
        self.runtime
            .blocking(move |database| database.finish_grade(id, grade.verdict, &grade.feedback))
            .await?;
        Ok(())
    }
}

/// The answer to question `id` and what it is graded against; `None` when it is graded
/// already or gone.
fn submission(database: &Database, id: QuestionId) -> study_core::Result<Option<Submission>> {
    // A graded answer keeps its grade, whatever reran its job.
    if !database.begin_grade(id)? {
        return Ok(None);
    }
    let Some(stored) = database.question(id)? else {
        return Ok(None);
    };
    let (Some(written), Some(PracticeAnswer::Open(answer))) = (stored.written, stored.answer)
    else {
        bail!("question {id} waits for a grade without an open answer");
    };
    let PracticeBody::Open {
        question,
        reference,
        ..
    } = written.body
    else {
        bail!("question {id} holds an open answer to another kind of question");
    };
    Ok(Some(Submission {
        question,
        reference,
        passages: stored.citations,
        answer,
    }))
}

impl JobHandler for GradeHandler {
    fn kind(&self) -> JobKind {
        JobKind::Grade
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(question) = job.target.question() else {
                return Err(wrong_target(&job));
            };
            self.grade(question).await?;
            Ok(Vec::new())
        })
    }
}
