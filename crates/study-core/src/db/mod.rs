//! The one local SQLite database for the entire application.
//!
//! Each area owns one file (or folder) with its record types and an `impl Database` block
//! holding its SQL. To find the SQL for a table, look it up here:
//!
//! | File            | Tables                                   | Records                                |
//! |-----------------|------------------------------------------|----------------------------------------|
//! | `projects.rs`   | `projects`                               | [`Project`]                            |
//! | `sources/`      | `sources`, `source_blobs`                | [`Source`], [`NewBytes`]               |
//! | `documents.rs`  | `documents`, `blocks`                    | a source's [`Document`](crate::Document) |
//! | `search/`       | `chunks`, `chunks_fts`, `embeddings`, `message_fts` | [`SearchHit`]                |
//! | `sessions.rs`   | `sessions`                               | [`ChatSession`]                        |
//! | `messages/`     | `messages`, `message_parts`              | [`ChatMessage`], [`MessagePart`], [`Thread`], [`ProjectMaterial`] |
//! | `citations.rs`  | `citations`, `artifact_citations`, `question_citations` | shared by messages, artifacts and questions |
//! | `recordings.rs` | `recordings`, `recording_chunks`         | [`Recording`]                          |
//! | `artifacts.rs`  | `artifacts`, `artifact_sources`          | [`Artifact`], [`Material`], [`Changes`] |
//! | `cards.rs`      | `cards`, `reviews`                       | [`Card`], [`DueCard`]                  |
//! | `practice/`     | `practices`, `practice_questions`        | [`Practice`], [`PracticeSummary`], [`PracticeQuestion`] |
//! | `jobs/`         | `jobs`, `job_deps`                       | [`Job`], [`NewJob`], [`JobOverview`]   |
//! | [`mod@crate::preferences`] | `preferences`                 | generic `(scope, key)` rows            |
//!
//! And the plumbing:
//!
//! | File            | What it does                                                  |
//! |-----------------|---------------------------------------------------------------|
//! | `store.rs`      | [`Store`], the shared pool every caller goes through          |
//! | `open.rs`       | Locating, opening, and migrating the file                     |
//! | `migrations/`   | The schema's numbered migrations and the runner that applies them |
//! | `staging.rs`    | Backdating and job outcomes for test support, behind the `testing` feature |
//!
//! Records that change in the background declare their events beside them with
//! [`crate::events!`]: [`MessageEvent`] and [`JobEvent`].
//!
//! A new area adds a file the same way, a row in the table above, and its tables in their
//! section of `migrations/0001_initial.sql` (the section header names the file), or a new
//! migration after the first release. Every enum column is a `crate::text_enum!` referencing
//! the table of its codes, added to `check_lists_match_the_rust_enums` in `migrations/mod.rs`;
//! that test fails on a codes column it does not know.
//!
//! Functions that take a `&Connection` run inside the caller's transaction, so a larger
//! write can include them atomically. This module stays synchronous; background work belongs
//! to the callers.

mod artifacts;
mod cards;
mod citations;
mod documents;
mod jobs;
mod messages;
mod migrations;
mod open;
mod practice;
mod projects;
mod recordings;
mod search;
mod sessions;
mod sources;
#[cfg(feature = "testing")]
mod staging;
mod store;

pub use artifacts::{Artifact, Changes, Material};
pub use cards::{Card, CardChange, DueCard};
pub use jobs::{Job, JobEvent, JobOverview, JobTarget, NewJob};
#[cfg(any(test, feature = "testing"))]
pub use messages::read_nothing;
pub use messages::{
    ChatMessage, MessageEvent, MessagePart, MessageRole, MessageStatus, NewPart, PartContent,
    Place, ProjectMaterial, Readable, Thread, ThreadSummary,
};
pub use practice::{Answered, Practice, PracticeQuestion, PracticeScore, PracticeSummary};
pub use projects::Project;
pub use recordings::{MAX_RECORDING_SAMPLES, RECORDING_SAMPLE_RATE, Recording};
pub use search::{ChunkDraft, PendingPassage, SearchHit, SearchKind, SearchTarget};
pub use sessions::{ChatSession, TitleSource};
pub use sources::{MAX_SOURCE_BYTES, NewBytes, Source};
pub use store::Store;

use rusqlite::{Connection, Row};
use serde::de::DeserializeOwned;
use std::time::{SystemTime, UNIX_EPOCH};

/// One connection to the database. Every record adds its queries in an `impl Database`
/// block in its own file; get one through [`Store::with`] or [`Store::run`].
pub struct Database {
    pub(crate) connection: Connection,
}

impl Database {
    /// A transaction that takes the write lock at once, waiting for it within the busy
    /// timeout. Every write transaction uses it: a deferred one that reads first fails at
    /// once, without waiting, when another connection writes in between.
    pub(crate) fn immediate(&self) -> rusqlite::Result<rusqlite::Transaction<'_>> {
        rusqlite::Transaction::new_unchecked(
            &self.connection,
            rusqlite::TransactionBehavior::Immediate,
        )
    }
}

/// Now, in seconds since the Unix epoch: the clock every stored time (`created_at`,
/// `updated_at`, a card's `due`, …) is written in and compared against.
pub fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// The most characters a title keeps, as the schema allows: a session's, a practice's or a
/// piece of study material's.
const MAX_TITLE_CHARS: usize = 200;

/// `text` trimmed, refused as [`ErrorKind::InvalidInput`](crate::ErrorKind::InvalidInput)
/// when nothing is left or more than `max_chars` characters are; `what` names it in the
/// error, such as `session title`.
fn trimmed(text: &str, what: &str, max_chars: usize) -> crate::Result<String> {
    let text = text.trim();
    if text.is_empty() {
        crate::bail!(crate::ErrorKind::InvalidInput, "{what} cannot be empty");
    }
    if text.chars().count() > max_chars {
        crate::bail!(
            crate::ErrorKind::InvalidInput,
            "{what} cannot exceed {max_chars} characters"
        );
    }
    Ok(text.to_owned())
}

/// `?, ?, ?` with `count` parameters, for an `IN (…)` list bound with `params_from_iter`.
fn placeholders(count: usize) -> String {
    vec!["?"; count].join(", ")
}

/// Reads a JSON text column, such as an `anchor`, as `T`.
fn json_column<T: DeserializeOwned>(row: &Row, index: usize) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, error.into())
    })
}
