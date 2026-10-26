//! Runs [`SessionTitle`] as a job: once the files of a session's first messages have been
//! read (the job waits for them), and whenever the user asks for a new title.

use study_ai::agent::AgentRuntime;
use study_core::db::{Job, JobTarget, NewJob, TitleSource};
use study_core::jobs::{BoxFuture, JobHandler, Lane, wrong_target};
use study_core::{Failure, JobKind, SessionId};

use super::SessionTitle;
use crate::agents::Conversation;

/// What a title job was asked for.
#[derive(Clone, Copy, Debug, Default, serde::Deserialize)]
struct TitleArgs {
    /// Replace any title, even one the user typed; otherwise only a provisional one.
    #[serde(default)]
    force: bool,
}

/// Names sessions. A job asked for with [`requested`](Self::requested) replaces any title,
/// even one the user typed; otherwise only a provisional title is replaced.
pub struct TitleHandler {
    runtime: AgentRuntime,
}

impl TitleHandler {
    /// Runs [`SessionTitle`] on `runtime`.
    pub fn new(runtime: AgentRuntime) -> Self {
        Self { runtime }
    }

    /// The job that names `session` now, from everything so far, whatever its title is.
    pub fn requested(session: SessionId) -> NewJob {
        NewJob::new(JobKind::Title, JobTarget::Session(session))
            .with_args(serde_json::json!({ "force": true }))
    }

    /// Names `session_id` when it has something to name it from and wants a title.
    async fn name(&self, session_id: SessionId, force: bool) -> Result<(), Failure> {
        let conversation = self
            .runtime
            .blocking(move |database| {
                let Some(session) = database.session(session_id)? else {
                    return Ok(None);
                };
                let conversation = Conversation::load(database, session_id)?;
                let wanted = !conversation.is_empty()
                    && (force || session.title_source == TitleSource::Provisional);
                Ok(wanted.then_some(conversation))
            })
            .await?;
        let Some(conversation) = conversation else {
            return Ok(());
        };
        // Without a model this fails as a setting to fix, so signing in names it after all.
        let agent = self.runtime.required::<SessionTitle>().await?;
        let title = agent.run(&conversation).await.map_err(Failure::from)?;
        self.runtime
            .blocking(move |database| {
                if force {
                    database.replace_with_generated_title(session_id, &title)
                } else {
                    database.set_generated_title(session_id, &title)
                }
            })
            .await?;
        Ok(())
    }
}

impl JobHandler for TitleHandler {
    fn kind(&self) -> JobKind {
        JobKind::Title
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(session_id) = job.target.session() else {
                return Err(wrong_target(&job));
            };
            let args: TitleArgs = job
                .args
                .map(serde_json::from_value)
                .transpose()
                .map_err(study_core::Error::from)?
                .unwrap_or_default();
            self.name(session_id, args.force).await?;
            Ok(Vec::new())
        })
    }
}
