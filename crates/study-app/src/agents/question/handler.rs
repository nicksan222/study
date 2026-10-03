//! Runs [`QuestionWriter`] as the `Question` job: once the practice's files are read and its
//! earlier questions written (the job waits for both), and again whenever the user retries.
//! A question reads what was read from every file of the practice's sessions, not the
//! files themselves, less what the [`Sifter`] drops as not worth studying, and their
//! notes. The sifter remembers its decisions, so a practice sifts its material once, not
//! once per question.

use std::hash::{DefaultHasher, Hash as _, Hasher as _};

use study_ai::agent::AgentRuntime;
use study_core::db::{Database, Job, NewJob};
use study_core::jobs::{BoxFuture, JobHandler, Lane, wrong_target};
use study_core::processing::{Excerpt, citations};
use study_core::{ErrorKind, Failure, JobKind, QuestionId, QuestionKind};
use study_pipeline::{Sifter, excerpts_of_sources};

use super::{Assignment, MAX_ASKED, QuestionWriter};

/// Writes practice questions.
pub struct QuestionHandler {
    runtime: AgentRuntime,
    sifter: Sifter,
}

/// What [`begin`] found a question's job has to do.
enum Start {
    /// Write it from this, once sifted.
    Write {
        kind: QuestionKind,
        ordinal: u32,
        title: String,
        excerpts: Vec<Excerpt>,
        notes: String,
        asked: Vec<String>,
    },
    /// Nothing: it is written already, or gone.
    Skip,
    /// Fail the job, leaving the question pending.
    Refuse(Failure),
}

impl QuestionHandler {
    /// Runs [`QuestionWriter`] on `runtime`, sifting with `sifter` (the pipeline's, so
    /// they share decisions).
    pub fn new(runtime: AgentRuntime, sifter: Sifter) -> Self {
        Self { runtime, sifter }
    }

    /// Writes question `id`, unless it is written or gone.
    async fn write(&self, id: QuestionId) -> Result<(), Failure> {
        // Before any work: without a model there is nothing to write with.
        let agent = self.runtime.required::<QuestionWriter>().await?;
        let start = self
            .runtime
            .blocking(move |database| begin(database, id))
            .await?;
        let assignment = match start {
            Start::Write {
                kind,
                ordinal,
                title,
                excerpts,
                notes,
                asked,
            } => {
                let excerpts = self.sifter.sift(&title, excerpts).await?;
                Assignment::fit(kind, ordinal, excerpts, notes, asked)
            }
            Start::Skip => return Ok(()),
            Start::Refuse(failure) => return Err(failure),
        };
        let mut written = agent.run(&assignment).await.map_err(Failure::from)?;
        written.body.turn_choices(spread(written.body.question()));
        // Its place asks for one kind; another is an answer to ask again for.
        let kind = written.body.kind();
        if kind != assignment.kind {
            return Err(Failure::new(
                ErrorKind::Transient,
                format!(
                    "asked for a question of kind {}, the model wrote one of kind {kind}",
                    assignment.kind
                ),
            ));
        }
        let citations = citations(&assignment.excerpts, written.body.cites().to_vec());
        self.runtime
            .blocking(move |database| database.finish_question(id, &written, &citations))
            .await?;
        Ok(())
    }
}

/// Marks question `id` as being written and gathers what it is written from, when there is
/// something to write from.
fn begin(database: &Database, id: QuestionId) -> study_core::Result<Start> {
    let Some(question) = database.question(id)? else {
        return Ok(Start::Skip);
    };
    // A written question is kept, whatever reran its job.
    if question.written.is_some() {
        return Ok(Start::Skip);
    }
    let Some(material) = database.practice_material(question.practice_id)? else {
        return Ok(Start::Skip);
    };
    let excerpts = excerpts_of_sources(database, &material.sources)?;
    if excerpts.is_empty() && material.notes.trim().is_empty() {
        return Ok(Start::Refuse(Failure::new(
            ErrorKind::Unsupported,
            "nothing has been read from this project",
        )));
    }
    let asked = database.asked_questions(question.practice_id, MAX_ASKED)?;
    if !database.begin_question(id)? {
        return Ok(Start::Skip);
    }
    // The practice is named by its project.
    let title = match database.practice_project(question.practice_id)? {
        Some(project) => database
            .project(project)?
            .map(|project| project.name)
            .unwrap_or_default(),
        None => String::new(),
    };
    Ok(Start::Write {
        kind: question.kind,
        ordinal: question.ordinal,
        title,
        excerpts,
        notes: material.notes,
        asked,
    })
}

/// How many places to turn a question's choices: from its text, so the right one lands
/// anywhere. The turned question is what is stored.
fn spread(question: &str) -> usize {
    let mut hasher = DefaultHasher::new();
    question.hash(&mut hasher);
    hasher.finish() as usize
}

impl JobHandler for QuestionHandler {
    fn kind(&self) -> JobKind {
        JobKind::Question
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(question) = job.target.question() else {
                return Err(wrong_target(&job));
            };
            self.write(question).await?;
            Ok(Vec::new())
        })
    }
}
