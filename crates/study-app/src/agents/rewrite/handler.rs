//! Runs [`Rewriter`] as a job for a message with a version waiting to be written, once the
//! message's files are read (the job waits for them), and again whenever the user retries.
//! The text read from the message's files goes to the model as numbered sources.

use study_ai::agent::AgentRuntime;
use study_core::Context as _;
use study_core::db::{Database, Job, NewJob, Rewrite, VersionOrigin};
use study_core::jobs::{BoxFuture, JobHandler, Lane, off_thread, wrong_target};
use study_core::processing::citations;
use study_core::{Failure, JobKind, MessageId, ProjectId, SourceId, VersionId, cited_markers};

use super::{Rewriter, Rewriting};
use crate::search::Retriever;

/// Most characters of the message's files a rewrite reads.
const FILES_BUDGET: usize = 16_000;

/// Writes the versions the student asked for.
pub struct RewriteHandler {
    runtime: AgentRuntime,
    retriever: Retriever,
}

/// A version to write, as read from the database.
struct Pending {
    version: VersionId,
    how: Rewrite,
    text: String,
    files: Vec<SourceId>,
    project: ProjectId,
}

impl RewriteHandler {
    /// Runs [`Rewriter`] on `runtime`, reading files through `retriever`.
    pub fn new(runtime: AgentRuntime, retriever: Retriever) -> Self {
        Self { runtime, retriever }
    }

    /// Writes the version waiting on message `id`, unless it was dropped.
    async fn rewrite(&self, id: MessageId) -> Result<(), Failure> {
        // Before any work: without a model there is nothing to write with.
        let agent = self.runtime.required::<Rewriter>().await?;
        let pending = self
            .runtime
            .blocking(move |database| pending(database, id))
            .await?;
        let Some(Pending {
            version,
            how,
            text,
            files,
            project,
        }) = pending
        else {
            return Ok(());
        };
        // Retrieval runs the search model; it holds no connection meanwhile.
        let retriever = self.retriever.clone();
        let query = text.clone();
        let excerpts =
            off_thread(move || retriever.retrieve(&query, project, &files, FILES_BUDGET, 0))
                .await??;
        let rewriting = Rewriting {
            how,
            text,
            excerpts,
        };
        let text = agent.run(&rewriting).await.map_err(Failure::from)?;
        let citations = citations(
            &rewriting.excerpts,
            cited_markers(&text, rewriting.excerpts.len() as u32),
        );
        self.runtime
            .blocking(move |database| database.finish_version(version, &text, &citations))
            .await?;
        Ok(())
    }
}

/// The version waiting on message `id`, once it is marked as being written; `None` when
/// there is none, or it is not a rewrite.
fn pending(database: &Database, id: MessageId) -> study_core::Result<Option<Pending>> {
    let Some(pending) = database.begin_version(id)? else {
        return Ok(None);
    };
    let how = match (pending.origin, pending.instruction) {
        (VersionOrigin::Improve, _) => Rewrite::Improve,
        (VersionOrigin::Summarize, _) => Rewrite::Summarize,
        (VersionOrigin::Instruction, Some(instruction)) => Rewrite::Instruction(instruction),
        // Only answers and the student's own text are not rewrites; their jobs are not this one.
        _ => return Ok(None),
    };
    let message = database
        .message(id)?
        .context("a version belongs to a message")?;
    let files = message
        .parts
        .iter()
        .filter_map(|part| part.content.source_id)
        .collect();
    let project = database
        .session(message.session_id)?
        .context("a message belongs to a session")?
        .project_id;
    Ok(Some(Pending {
        version: pending.id,
        how,
        text: pending.source_text,
        files,
        project,
    }))
}

impl JobHandler for RewriteHandler {
    fn kind(&self) -> JobKind {
        JobKind::Rewrite
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(message) = job.target.message() else {
                return Err(wrong_target(&job));
            };
            self.rewrite(message).await?;
            Ok(Vec::new())
        })
    }
}
