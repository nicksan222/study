//! Jobs: every piece of background work, as durable rows. The engine in
//! [`crate::jobs`] claims and runs them; this module only stores them.
//!
//! A job targets one subject (a source, a document, a session, a message, an artifact or a
//! practice question) and is deleted with it. Jobs queued with `after` wait, `blocked`, until
//! those jobs have ended however they ended, or are gone; then they are released. The same
//! work queued twice while it still waits is kept once, by its dedupe key, with the
//! dependencies of both; a job that would wait again while its twin already waits leaves the
//! work to the twin.
//!
//! | File           | What it holds                                                      |
//! |----------------|--------------------------------------------------------------------|
//! | `mod.rs`       | The records, row mapping, shared SQL fragments, and [`JobEvent`]   |
//! | `lifecycle.rs` | Every status change: enqueue, claim, succeed, fail, cancel, retry  |
//! | `queries.rs`   | Reads: one job, jobs on a subject, the overview, a job's scope     |

mod lifecycle;
mod queries;
#[cfg(test)]
mod tests;

pub(super) use lifecycle::{cancel_unfinished, enqueue};
pub(super) use queries::{pending_questions_of, pending_reads_of};

use crate::{
    ArtifactId, DocumentId, ErrorKind, JobId, JobKind, JobStatus, MessageId, PracticeId, ProjectId,
    QuestionId, Requirement, SessionId, SourceId, SourceKind,
};
use rusqlite::Row;

/// What a job works on.
///
/// Each variant has its own nullable column in `jobs`; exactly one is set. A handler takes
/// the id it expects with the accessor of the same name, and fails the job otherwise:
/// `let Some(message) = job.target.message() else { return Err(…) };`.
///
/// ```
/// use study_core::db::JobTarget;
/// use study_core::MessageId;
///
/// let target = JobTarget::Message(MessageId::new(7));
/// assert_eq!(target.message(), Some(MessageId::new(7)));
/// assert_eq!(target.source(), None);
/// ```
///
/// To add a target, change, in this crate:
/// 1. this enum, its arm in `JobTarget::column`, and an accessor like [`JobTarget::source`];
/// 2. `JobTarget::COLUMNS` and `JobTarget::from_row`, in the same order, and the end of
///    `JOB_COLUMNS`;
/// 3. in `0001_initial.sql`, the `jobs` column (with `ON DELETE CASCADE`), its
///    `jobs_<subject>_idx` index and its term in the one-target `CHECK`;
/// 4. `JOB_SOURCE` and `JOB_SESSION` if the subject leads to a source or a chat, and the
///    joins in `list_job_overviews` if it has a name to show;
/// 5. `one_of_each` in `db/jobs/tests.rs`, which fails to compile until then.
///
/// The tests `every_target_round_trips_through_its_column` and
/// `the_schema_has_a_column_index_and_check_for_every_target` catch a missed step.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum JobTarget {
    Source(SourceId),
    Document(DocumentId),
    Session(SessionId),
    Message(MessageId),
    Artifact(ArtifactId),
    Question(QuestionId),
}

impl JobTarget {
    /// Every target column of `jobs`, in the order [`Self::from_row`] reads them.
    const COLUMNS: [&'static str; 6] = [
        "source_id",
        "document_id",
        "session_id",
        "message_id",
        "artifact_id",
        "question_id",
    ];

    /// The source this job works on, if it targets one.
    pub fn source(self) -> Option<SourceId> {
        let Self::Source(id) = self else { return None };
        Some(id)
    }

    /// The document this job works on, if it targets one.
    pub fn document(self) -> Option<DocumentId> {
        let Self::Document(id) = self else {
            return None;
        };
        Some(id)
    }

    /// The session this job works on, if it targets one.
    pub fn session(self) -> Option<SessionId> {
        let Self::Session(id) = self else { return None };
        Some(id)
    }

    /// The message this job works on, if it targets one.
    pub fn message(self) -> Option<MessageId> {
        let Self::Message(id) = self else { return None };
        Some(id)
    }

    /// The artifact this job works on, if it targets one.
    pub fn artifact(self) -> Option<ArtifactId> {
        let Self::Artifact(id) = self else {
            return None;
        };
        Some(id)
    }

    /// The practice question this job works on, if it targets one.
    pub fn question(self) -> Option<QuestionId> {
        let Self::Question(id) = self else {
            return None;
        };
        Some(id)
    }

    /// The `jobs` column that holds this target, and the id stored in it.
    fn column(self) -> (&'static str, i64) {
        match self {
            Self::Source(id) => ("source_id", id.get()),
            Self::Document(id) => ("document_id", id.get()),
            Self::Session(id) => ("session_id", id.get()),
            Self::Message(id) => ("message_id", id.get()),
            Self::Artifact(id) => ("artifact_id", id.get()),
            Self::Question(id) => ("question_id", id.get()),
        }
    }

    /// Reads the [`Self::COLUMNS`] starting at `at`; `None` when none is set.
    fn from_row(row: &Row, at: usize) -> rusqlite::Result<Option<Self>> {
        let set = [
            row.get::<_, Option<SourceId>>(at)?.map(Self::Source),
            row.get::<_, Option<DocumentId>>(at + 1)?
                .map(Self::Document),
            row.get::<_, Option<SessionId>>(at + 2)?.map(Self::Session),
            row.get::<_, Option<MessageId>>(at + 3)?.map(Self::Message),
            row.get::<_, Option<ArtifactId>>(at + 4)?
                .map(Self::Artifact),
            row.get::<_, Option<QuestionId>>(at + 5)?
                .map(Self::Question),
        ];
        Ok(set.into_iter().flatten().next())
    }

    /// This target in a dedupe key, such as `source:7`.
    fn key(self) -> String {
        let (column, id) = self.column();
        let subject = column.strip_suffix("_id").unwrap_or(column);
        format!("{subject}:{id}")
    }
}

/// Work to queue.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewJob {
    pub kind: JobKind,
    pub target: JobTarget,
    /// Kind-specific options, such as a title asked for again.
    pub args: Option<serde_json::Value>,
    /// Jobs that must end first.
    pub after: Vec<JobId>,
}

impl NewJob {
    /// Work of `kind` on `target`, with no options and nothing to wait for.
    pub fn new(kind: JobKind, target: JobTarget) -> Self {
        Self {
            kind,
            target,
            args: None,
            after: Vec::new(),
        }
    }

    /// With kind-specific options; different options make different work.
    pub fn with_args(mut self, args: serde_json::Value) -> Self {
        self.args = Some(args);
        self
    }

    /// Waiting until `jobs` have ended.
    pub fn after(mut self, jobs: impl IntoIterator<Item = JobId>) -> Self {
        self.after.extend(jobs);
        self
    }

    /// Identical waiting work is kept once.
    fn dedupe_key(&self) -> String {
        let mut key = format!("{}:{}", self.kind, self.target.key());
        if let Some(args) = &self.args {
            key.push(':');
            key.push_str(&args.to_string());
        }
        key
    }
}

/// A stored job.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Job {
    pub id: JobId,
    pub kind: JobKind,
    pub target: JobTarget,
    pub args: Option<serde_json::Value>,
    pub status: JobStatus,
    pub attempts: u32,
    pub error_kind: Option<ErrorKind>,
    /// The latest failure's full message, for anyone who wants the details.
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// When the latest attempt began.
    pub started_at: Option<i64>,
    /// When the latest attempt ended.
    pub finished_at: Option<i64>,
    /// What it waits for the user to set up, while it is [`JobStatus::Waiting`].
    pub waiting_for: Option<Requirement>,
    /// What must be set up before it can run: its own `waiting_for`, or, while it is
    /// blocked, that of a waiting job it depends on, however indirectly.
    pub needs: Option<Requirement>,
}

/// The columns [`Job::from_row`] maps, from `jobs j`; joined columns follow them. The target
/// columns come last, in [`JobTarget::COLUMNS`] order, so a new target is appended here.
///
/// `needs` is worked out here: a blocked job looks through the blocked jobs it depends on
/// for one that waits. The expression has no commas, as the schema test splits the list on
/// them.
const JOB_COLUMNS: &str = "j.id, j.kind, j.args, j.status, j.attempts, j.error_kind, j.error,
    j.created_at, j.updated_at, j.started_at, j.finished_at, j.waiting_for,
    CASE WHEN j.waiting_for IS NOT NULL THEN j.waiting_for WHEN j.status = 'blocked' THEN (
        WITH RECURSIVE awaited(id) AS (
            SELECT depends_on FROM job_deps WHERE job_id = j.id
            UNION SELECT dep.depends_on FROM awaited
                JOIN jobs mid ON mid.id = awaited.id AND mid.status = 'blocked'
                JOIN job_deps dep ON dep.job_id = mid.id)
        SELECT w.waiting_for FROM awaited JOIN jobs w ON w.id = awaited.id
        WHERE w.status = 'waiting' ORDER BY w.id LIMIT 1) END,
    j.source_id, j.document_id, j.session_id, j.message_id, j.artifact_id, j.question_id";

/// Where the target columns start in [`JOB_COLUMNS`].
const JOB_TARGET_AT: usize = 13;

/// The number of columns in [`JOB_COLUMNS`], where joined columns start.
const JOB_WIDTH: usize = JOB_TARGET_AT + JobTarget::COLUMNS.len();

impl Job {
    /// Maps the [`JOB_COLUMNS`].
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let target = JobTarget::from_row(row, JOB_TARGET_AT)?.ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                JOB_TARGET_AT,
                rusqlite::types::Type::Null,
                "a job without a target".into(),
            )
        })?;
        let args: Option<String> = row.get(2)?;
        Ok(Self {
            id: row.get(0)?,
            kind: row.get(1)?,
            target,
            args: args.and_then(|args| serde_json::from_str(&args).ok()),
            status: row.get(3)?,
            attempts: row.get(4)?,
            error_kind: row.get(5)?,
            error: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            started_at: row.get(9)?,
            finished_at: row.get(10)?,
            waiting_for: row.get(11)?,
            needs: row.get(12)?,
        })
    }
}

/// A job with what it works on and where that lives, for the pipelines overview.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobOverview {
    pub job: Job,
    /// The file, the study material, the practice, or the session the job is about.
    pub subject: String,
    /// The kind of file, when the job is about one.
    pub source_kind: Option<SourceKind>,
    pub source_id: Option<SourceId>,
    /// The chat it belongs to, if any.
    pub session_id: Option<SessionId>,
    pub session_title: Option<String>,
    pub project_id: Option<ProjectId>,
    pub project_name: Option<String>,
    /// The practice whose question it writes or grades, if any.
    pub practice_id: Option<PracticeId>,
}

/// Where a job's news should go: the source and the chat it concerns.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct JobScope {
    pub source_id: Option<SourceId>,
    pub session_id: Option<SessionId>,
}

/// Statuses of work not yet ended, as an SQL list.
pub(in crate::db) const PENDING: &str = "('blocked', 'queued', 'waiting', 'running')";

/// Statuses of work not yet started, as an SQL list; the dedupe index covers exactly these.
const NOT_STARTED: &str = "('blocked', 'queued', 'waiting')";

/// The source a job works on, directly or through its document.
const JOB_SOURCE: &str = "coalesce(j.source_id,
    (SELECT d.source_id FROM documents d WHERE d.id = j.document_id))";

/// The chat a job belongs to: its session, its message's session, or the session its source
/// was first attached in.
const JOB_SESSION: &str = "coalesce(j.session_id,
    (SELECT m.session_id FROM messages m WHERE m.id = j.message_id),
    (SELECT m.session_id FROM message_parts p JOIN messages m ON m.id = p.message_id
     WHERE p.source_id = coalesce(j.source_id,
         (SELECT d.source_id FROM documents d WHERE d.id = j.document_id))
     ORDER BY p.id LIMIT 1))";

crate::events! {
    /// A job changed status. The database holds the truth; these say when to look.
    pub enum JobEvent for Job {
        Changed {
            job_id: JobId,
            kind: JobKind,
            status: JobStatus,
            source_id: Option<SourceId>,
            session_id: Option<SessionId>,
        },
    }
}

impl JobEvent {
    /// The chat the job belongs to, if any.
    pub fn session_id(&self) -> Option<SessionId> {
        match self {
            Self::Changed { session_id, .. } => *session_id,
        }
    }
}
