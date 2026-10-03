//! Runs [`Answer`] as a job for a pending assistant message: once the question's files are
//! read (the job waits for them), and again whenever the user retries. An answer reads what
//! was read from every file above the question in its place (transcripts, recognized text,
//! pages), not the files themselves: on the timeline, every file attached so far; in a
//! thread, the thread's file and those attached in it.

use study_ai::agent::AgentRuntime;
use study_core::Context as _;
use study_core::db::{ChatMessage, Database, Job, MessageRole, NewJob, PartContent};
use study_core::jobs::{BoxFuture, JobHandler, Lane, off_thread, wrong_target};
use study_core::processing::citations;
use study_core::{
    Failure, JobKind, MessageId, ProjectId, SourceId, cited_markers, without_mention,
};

use super::{Answer, Question};
use crate::agents::Conversation;
use crate::search::Retriever;

/// Most characters of the session's files an answer reads.
const FILES_BUDGET: usize = 16_000;
/// Most passages of the project's other files an answer draws on.
const MAX_OTHER_EXCERPTS: usize = 6;

/// Writes assistant messages.
pub struct ReplyHandler {
    runtime: AgentRuntime,
    retriever: Retriever,
}

/// The note an answer replies to, as read from its session or thread.
struct Asked {
    /// The messages before the note.
    earlier: Conversation,
    /// The note's text, without the mention that asked for an answer.
    text: String,
    /// Every file above the note in its place, the note's own included, oldest first.
    files: Vec<SourceId>,
    project: ProjectId,
}

impl ReplyHandler {
    /// Runs [`Answer`] on `runtime`, from what `retriever` finds.
    pub fn new(runtime: AgentRuntime, retriever: Retriever) -> Self {
        Self { runtime, retriever }
    }

    /// Writes the answer `id`, unless it is finished or gone.
    async fn answer(&self, id: MessageId) -> Result<(), Failure> {
        // Before any work: without a model there is nothing to write with.
        let agent = self.runtime.required::<Answer>().await?;
        let asked = self
            .runtime
            .blocking(move |database| asked(database, id))
            .await?;
        let Some(Asked {
            earlier,
            text,
            files,
            project,
        }) = asked
        else {
            return Ok(());
        };
        // Retrieval runs the search model; it holds no connection meanwhile.
        let retriever = self.retriever.clone();
        let query = text.clone();
        let excerpts = off_thread(move || {
            retriever.retrieve(&query, project, &files, FILES_BUDGET, MAX_OTHER_EXCERPTS)
        })
        .await??;
        let question = Question {
            earlier,
            text,
            excerpts,
        };
        let text = agent.run(&question).await.map_err(Failure::from)?;
        let citations = citations(
            &question.excerpts,
            cited_markers(&text, question.excerpts.len() as u32),
        );
        self.runtime
            .blocking(move |database| database.finish_reply(id, &text, &citations))
            .await?;
        Ok(())
    }
}

/// What answer `id` replies to, once it is marked as being written; `None` when it is
/// finished already or gone.
fn asked(database: &Database, id: MessageId) -> study_core::Result<Option<Asked>> {
    // A finished answer is kept, whatever reran its job.
    if !database.begin_reply(id)? {
        return Ok(None);
    }
    let Some(answer) = database.message(id)? else {
        return Ok(None);
    };
    let (messages, about) = match answer.thread_root {
        None => (database.list_messages(answer.session_id)?, None),
        Some(root) => {
            let thread = database
                .thread(root)?
                .context("an answer in a thread has its attachment")?;
            let about = thread.root.content.source_id();
            let mut messages = vec![thread.opening()];
            messages.extend(thread.replies);
            (messages, about)
        }
    };
    let position = messages
        .iter()
        .position(|message| Some(message.id) == answer.reply_to)
        .context("an answer replies to a message beside it")?;
    let text = note_text(&messages[position]);
    let files = files_above(about, &messages[..=position]);
    let project = database
        .session(answer.session_id)?
        .context("an answer belongs to a session")?
        .project_id;
    // Earlier answers still being written are no context.
    let earlier: Vec<_> = messages[..position]
        .iter()
        .filter(|message| message.role == MessageRole::User || !message.parts.is_empty())
        .cloned()
        .collect();
    Ok(Some(Asked {
        earlier: Conversation::from_messages(&earlier),
        text,
        files,
        project,
    }))
}

/// The text of `note`, without the mention that asked for an answer.
fn note_text(note: &ChatMessage) -> String {
    note.parts
        .iter()
        .filter_map(|part| match &part.content {
            PartContent::Text(text) => Some(without_mention(text)),
            PartContent::Source { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The file a thread hangs off (`about`), then every file attached in `messages`, each
/// once, oldest first.
fn files_above(about: Option<SourceId>, messages: &[ChatMessage]) -> Vec<SourceId> {
    let attached = messages
        .iter()
        .flat_map(|message| &message.parts)
        .filter_map(|part| part.content.source_id());
    let mut files: Vec<SourceId> = Vec::new();
    for source in about.into_iter().chain(attached) {
        if !files.contains(&source) {
            files.push(source);
        }
    }
    files
}

impl JobHandler for ReplyHandler {
    fn kind(&self) -> JobKind {
        JobKind::Reply
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(message) = job.target.message() else {
                return Err(wrong_target(&job));
            };
            self.answer(message).await?;
            Ok(Vec::new())
        })
    }
}
