//! Background jobs in plain words: what one is doing while it runs, and what went wrong when it
//! failed. The raw error stays available for anyone who wants it; this is what everyone sees.

use study_app::views::{Job, JobKind, JobStatus};
use study_core::processing::{ExtractorKind, first_extractor};
use study_core::{ErrorKind, SourceKind};
use study_localization::{Locale, Message, status_with_duration, text};

/// What a failure means for the person using the app, and what they can do about it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Problem {
    /// The service refused the sign-in.
    SignIn,
    /// An online service could not be reached, or took too long.
    Connection,
    /// An online service is busy or limiting requests.
    Busy,
    /// The source was deleted from the Library.
    FileRemoved,
    /// What a job other than a source's worked on (a session, a question, …) was deleted.
    Gone,
    /// The file is not something this step can read.
    NotReadable,
    /// What the work was made from holds too little for it, as the model said.
    NotEnough,
    /// A local model is missing or would not load.
    Model,
    /// A setting is missing or wrong.
    Setup,
    /// Anything else, or a failure that recorded no kind.
    Unknown,
}

impl Problem {
    /// What a stored failure kind means for a job of `job`'s kind. Every kind is decided
    /// here, so a new one cannot slip through unexplained.
    pub fn of(kind: ErrorKind, job: JobKind) -> Self {
        match kind {
            ErrorKind::Auth => Self::SignIn,
            ErrorKind::Transient => Self::Connection,
            ErrorKind::RateLimited => Self::Busy,
            // Only a source's jobs work on a Library file; the rest lose a session, a
            // question or an answer.
            ErrorKind::NotFound => match job {
                JobKind::Extract | JobKind::Index | JobKind::Embed | JobKind::Fetch => {
                    Self::FileRemoved
                }
                JobKind::Title
                | JobKind::Reply
                | JobKind::Rewrite
                | JobKind::Artifact
                | JobKind::Question
                | JobKind::Grade => Self::Gone,
            },
            ErrorKind::Unsupported | ErrorKind::InvalidInput => Self::NotReadable,
            ErrorKind::NotEnough => Self::NotEnough,
            ErrorKind::ModelUnavailable => Self::Model,
            ErrorKind::Config => Self::Setup,
            ErrorKind::Cancelled | ErrorKind::Internal => Self::Unknown,
        }
    }

    /// Why a failed job failed; `Unknown` when it recorded no kind.
    pub fn of_job(job: &Job) -> Self {
        job.error_kind
            .map_or(Self::Unknown, |kind| Self::of(kind, job.kind))
    }

    /// The problem in a sentence, as the page explains it.
    pub fn explanation(self) -> Message {
        match self {
            Self::SignIn => Message::ProblemSignIn,
            Self::Connection => Message::ProblemConnection,
            Self::Busy => Message::ProblemBusy,
            Self::FileRemoved => Message::FileRemovedFromLibrary,
            Self::Gone => Message::ProblemGone,
            Self::NotReadable => Message::ProblemNotReadable,
            Self::NotEnough => Message::ProblemNotEnough,
            Self::Model => Message::ProblemModel,
            Self::Setup => Message::ProblemSetup,
            Self::Unknown => Message::ProblemUnknown,
        }
    }

    /// Whether the fix is in Settings, so the page can offer to go there.
    pub fn fixed_in_settings(self) -> bool {
        matches!(self, Self::SignIn | Self::Model | Self::Setup)
    }
}

/// What a job does, for the reader. A read is named for the extractor its source is read
/// with first.
pub fn job_label(kind: JobKind, source: Option<SourceKind>) -> Message {
    match kind {
        JobKind::Extract => match source.and_then(first_extractor) {
            Some(ExtractorKind::Transcription) => Message::StageTranscription,
            Some(ExtractorKind::Vision) => Message::StageVision,
            Some(ExtractorKind::Office | ExtractorKind::Web | ExtractorKind::Text) | None => {
                Message::StageReading
            }
        },
        JobKind::Index => Message::StageIndex,
        JobKind::Embed => Message::StageEmbed,
        JobKind::Title => Message::StageTitle,
        JobKind::Reply => Message::StageReply,
        JobKind::Rewrite => Message::StageRewrite,
        JobKind::Artifact => Message::StageArtifact,
        JobKind::Question => Message::StageQuestion,
        JobKind::Grade => Message::StageGrade,
        JobKind::Fetch => Message::StageFetch,
    }
}

/// What a running job is doing, in a few words.
fn activity(kind: JobKind, source: Option<SourceKind>) -> Message {
    match kind {
        JobKind::Extract => match source.and_then(first_extractor) {
            Some(ExtractorKind::Transcription) => Message::ActivityListening,
            _ => Message::ActivityReading,
        },
        JobKind::Reply | JobKind::Rewrite | JobKind::Artifact | JobKind::Question => {
            Message::ActivityWriting
        }
        JobKind::Grade => Message::ActivityChecking,
        JobKind::Title | JobKind::Index | JobKind::Embed | JobKind::Fetch => {
            Message::ActivityWorking
        }
    }
}

/// What state a job is in, in a word or two. A running job says what it is doing instead,
/// with [`running_line`], where its kind is known.
pub fn status_label(status: JobStatus) -> Message {
    match status {
        JobStatus::Blocked | JobStatus::Waiting => Message::StatusWaiting,
        JobStatus::Queued => Message::StatusQueued,
        JobStatus::Running => Message::ActivityWorking,
        JobStatus::Succeeded => Message::StatusFinished,
        JobStatus::Failed => Message::StatusFailed,
        JobStatus::Cancelled => Message::StatusStopped,
    }
}

/// What the button that starts a stopped job again says: trying again after it failed,
/// starting again after it was stopped.
pub fn retry_label(status: JobStatus) -> Message {
    match status {
        JobStatus::Failed => Message::RetryJob,
        _ => Message::StartJob,
    }
}

/// What a running job is doing and for how long, as one line, such as "Writing · 12 s".
pub fn running_line(locale: Locale, job: &Job, source: Option<SourceKind>, now: i64) -> String {
    status_with_duration(
        text(locale, activity(job.kind, source)),
        elapsed(job, now).unwrap_or_default(),
    )
}

/// Seconds a job has been running, or ran for.
pub fn elapsed(job: &Job, now: i64) -> Option<i64> {
    let started = job.started_at?;
    let end = match job.status {
        JobStatus::Running => now,
        _ => job.finished_at?,
    };
    Some((end - started).max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_failure_kind_has_a_plain_problem() {
        let of = |kind| Problem::of(kind, JobKind::Extract);
        assert_eq!(of(ErrorKind::Auth), Problem::SignIn);
        assert_eq!(of(ErrorKind::Transient), Problem::Connection);
        assert_eq!(of(ErrorKind::RateLimited), Problem::Busy);
        assert_eq!(of(ErrorKind::Unsupported), Problem::NotReadable);
        assert_eq!(of(ErrorKind::NotEnough), Problem::NotEnough);
        assert!(!Problem::NotEnough.fixed_in_settings());
        assert_eq!(of(ErrorKind::Internal), Problem::Unknown);
        assert!(of(ErrorKind::Config).fixed_in_settings());
        assert!(Problem::SignIn.fixed_in_settings());
        assert!(!Problem::Connection.fixed_in_settings());
    }

    #[test]
    fn only_a_source_job_missing_its_target_lost_a_file() {
        for kind in [JobKind::Extract, JobKind::Index, JobKind::Embed] {
            assert_eq!(Problem::of(ErrorKind::NotFound, kind), Problem::FileRemoved);
        }
        for kind in [
            JobKind::Title,
            JobKind::Reply,
            JobKind::Artifact,
            JobKind::Question,
            JobKind::Grade,
        ] {
            assert_eq!(Problem::of(ErrorKind::NotFound, kind), Problem::Gone);
        }
    }

    #[test]
    fn reads_are_named_for_what_they_read() {
        let read = |source| job_label(JobKind::Extract, Some(source));
        assert_eq!(read(SourceKind::Audio), Message::StageTranscription);
        assert_eq!(read(SourceKind::Pdf), Message::StageVision);
        assert_eq!(read(SourceKind::Text), Message::StageReading);
        assert_eq!(read(SourceKind::Code), Message::StageReading);
        assert_eq!(job_label(JobKind::Title, None), Message::StageTitle);
    }
}
