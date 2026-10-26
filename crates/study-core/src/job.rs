//! Background work, by kind. Every piece of work Study does in the background is a job of
//! one of these kinds, stored as a row so nothing is lost when the app quits.
//!
//! Most kinds are stages of the source pipeline, routed in `study_core::processing`; Fetch
//! (a link's fetchers) and Artifact (the enhancers) are pipeline work no route lists. All of
//! them are implemented in `study-pipeline`; the rest (a session's title, a reply, a rewrite, a practice
//! question and its grade) are the agents' in `study-app`. A new
//! [`JobKind`] is one line here plus its code as a row of `codes_job_kind` (see `db::migrations`
//! for where); `every_job_kind_has_exactly_one_handler` in `study-app`
//! names what else is missing.

crate::text_enum! {
    /// What a job does.
    pub enum JobKind {
        /// Reads a source into its document.
        Extract = "extract",
        /// Splits a document into search passages.
        Index = "index",
        /// Embeds a document's passages for semantic search.
        Embed = "embed",
        /// Names a session from its conversation.
        Title = "title",
        /// Writes the assistant's answer to a message that mentions it.
        Reply = "reply",
        /// Generates study material with an enhancer, when the user asks.
        Artifact = "artifact",
        /// Writes the next question of a practice.
        Question = "question",
        /// Grades an answer to an open practice question.
        Grade = "grade",
        /// Brings in what a link source's address holds.
        Fetch = "fetch",
        /// Writes a new version of a message: an improvement, a summary or what the student
        /// asked for.
        Rewrite = "rewrite",
    }
}

impl JobKind {
    /// What the job needs set up before it can run, when that does not depend on what it
    /// works on; `None` for [`Extract`](Self::Extract), whose need depends on the extractor
    /// that reads the source ([`crate::processing::requirement`] answers for it).
    ///
    /// Exhaustive, so a new kind must decide here.
    pub const fn requirement(self) -> Option<Requirement> {
        match self {
            Self::Title
            | Self::Reply
            | Self::Rewrite
            | Self::Artifact
            | Self::Question
            | Self::Grade => Some(Requirement::LanguageModels),
            Self::Embed => Some(Requirement::SearchModel),
            // Splitting a document into passages, or fetching a page, needs no model.
            Self::Index | Self::Extract | Self::Fetch => None,
        }
    }

    /// Whether it is an automatic stage after reading, which a route can list. Exhaustive,
    /// so a new kind must decide here.
    pub const fn follows_reading(self) -> bool {
        match self {
            Self::Index | Self::Embed => true,
            Self::Extract
            | Self::Title
            | Self::Reply
            | Self::Rewrite
            | Self::Artifact
            | Self::Question
            | Self::Grade
            | Self::Fetch => false,
        }
    }

    /// The stage whose output this stage works on: a plan without it drops this one too.
    /// Exhaustive, so a new kind must decide here.
    pub const fn builds_on(self) -> Option<Self> {
        match self {
            Self::Embed => Some(Self::Index),
            Self::Extract
            | Self::Index
            | Self::Title
            | Self::Reply
            | Self::Rewrite
            | Self::Artifact
            | Self::Question
            | Self::Grade
            | Self::Fetch => None,
        }
    }

    /// Whether the job runs on a language model tier, so it waits for the language model
    /// settings and starts again once someone signs in.
    pub const fn needs_language_model(self) -> bool {
        matches!(self.requirement(), Some(Requirement::LanguageModels))
    }
}

crate::text_enum! {
    /// What a piece of work needs set up to run: a model the user installs or chooses a
    /// provider for. A job waiting for it names it, so the UI can open the right place in
    /// Settings; every processor declares its own.
    pub enum Requirement {
        /// Speech-to-text, for recordings and videos.
        Transcription = "transcription",
        /// The local embedding model, for search by meaning.
        SearchModel = "search_model",
        /// A language model tier.
        LanguageModels = "language_models",
    }
}

crate::text_enum! {
    /// Where a job is in its life.
    pub enum JobStatus {
        /// Waiting for other jobs to end first.
        Blocked = "blocked",
        Queued = "queued",
        /// Waiting for something the user sets up, named by `waiting_for`.
        Waiting = "waiting",
        Running = "running",
        Succeeded = "succeeded",
        Failed = "failed",
        /// Stopped by the user.
        Cancelled = "cancelled",
    }
}

impl JobStatus {
    /// Whether the job has ended, one way or another.
    ///
    /// Exhaustive, so a new status must decide here. Every status is either terminal or
    /// pending.
    pub const fn is_terminal(self) -> bool {
        match self {
            Self::Succeeded | Self::Failed | Self::Cancelled => true,
            Self::Blocked | Self::Queued | Self::Waiting | Self::Running => false,
        }
    }

    /// Whether the job ended without doing its work: it failed or was cancelled, so it
    /// may be retried.
    pub const fn is_stopped(self) -> bool {
        matches!(self, Self::Failed | Self::Cancelled)
    }

    /// Whether the job still has work ahead: the opposite of [`is_terminal`](Self::is_terminal).
    pub const fn is_pending(self) -> bool {
        !self.is_terminal()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_split_into_pending_and_terminal() {
        let pending: Vec<_> = JobStatus::ALL
            .iter()
            .filter(|status| status.is_pending())
            .collect();
        assert_eq!(
            pending,
            [
                &JobStatus::Blocked,
                &JobStatus::Queued,
                &JobStatus::Waiting,
                &JobStatus::Running
            ]
        );
    }
}
