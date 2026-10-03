//! What the Study crates build on (all but the UI kit, diagrams and the test kit): the shared
//! vocabulary (IDs, text enums, errors, source kinds, documents, jobs, study material), the
//! interfaces of every processor and the routes that choose them, and the database,
//! preferences, event bus and jobs engine.
//!
//! Vocabulary, re-exported at the root:
//!
//! | Module          | What it holds                                                      |
//! |-----------------|--------------------------------------------------------------------|
//! | [`mod@id`]      | [`id!`] and the newtype ID of every entity                         |
//! | `text_enum`     | [`text_enum!`] and [`UnknownCode`]: enums stored as text codes     |
//! | [`error`]       | [`Error`] + [`Result`] + [`Context`] (the libraries' error, with [`err!`] and [`bail!`]), [`ErrorKind`], [`Classify`], [`Failure`] |
//! | [`source_kind`] | [`SourceKind`] and [`sniff`], the one place that knows file kinds  |
//! | [`document`]    | [`Document`], [`Block`] and [`Anchor`]: the text of every source   |
//! | [`day`]         | [`Day`]: a calendar date without a time, such as an exam's         |
//! | [`citation`]    | [`Citation`]: where a generated text's claims come from            |
//! | [`job`]         | [`JobKind`], [`JobStatus`] and [`Requirement`]: background work    |
//! | [`artifact`]    | [`ArtifactKind`] and [`ArtifactBody`]: generated study material    |
//! | [`practice`]    | [`QuestionKind`], [`WrittenQuestion`], [`PracticeBody`], [`PracticeAnswer`] and [`Verdict`]: endless quizzes over sessions |
//! | [`srs`]         | [`Memory`] and [`Rating`]: spaced repetition with FSRS-5           |
//! | [`language`]    | [`Language`]: what the interface speaks and every agent writes in  |
//! | [`mention`]     | [`Mention`] and [`mentions`]: when a note asks for an answer or a tool |
//! | [`text`]        | Truncation and title helpers                                       |
//!
//! Services:
//!
//! | Module          | What it holds                                                      |
//! |-----------------|--------------------------------------------------------------------|
//! | [`db`]          | The one SQLite database: [`db::Store`] and every record            |
//! | [`mod@preferences`] | [`preferences!`] and [`choice!`], so each crate declares its own |
//! | [`jobs`]        | The engine that runs durable background jobs through handlers      |
//! | [`processing`]  | Every processor's interface, and [`processing::ROUTES`]: what each kind of source goes through |
//! | [`bus`]         | The event bus: typed broadcasts of what has happened               |
//! | [`paths`]       | Where app data and caches live on this platform                    |
//!
//! Feature crates own their behaviour and their settings; this crate only holds what more
//! than one of them needs.

pub mod artifact;
pub mod citation;
pub mod day;
pub mod document;
pub mod error;
pub mod id;
pub mod job;
pub mod language;
pub mod mention;
pub mod practice;
pub mod source_kind;
pub mod srs;
pub mod text;
mod text_enum;

pub mod bus;
pub mod db;
pub mod jobs;
pub mod paths;
pub mod preferences;
pub mod processing;

pub use artifact::{ArtifactBody, ArtifactKind, ArtifactStatus, Flashcard};
pub use citation::{Citation, cited_markers, without_citations};
pub use day::Day;
pub use document::{Anchor, Block, BlockKind, Document, DocumentMeta, Stamp};
pub use error::{Classify, Context, Error, ErrorKind, Failure, Result};
pub use id::{
    ArtifactId, CardId, ChunkId, DocumentId, JobId, MessageId, PartId, PracticeId, ProjectId,
    QuestionId, RecordingId, SessionId, SourceId, VersionId,
};
pub use job::{JobKind, JobStatus, Requirement};
pub use language::{Language, LanguagePreferences};
pub use mention::{
    ASSISTANT_MENTION, ASSISTANT_PREFIX, Mention, mentions, mentions_named, rewrite_mentions,
    without_mention,
};
pub use practice::{
    PracticeAnswer, PracticeBody, QuestionKind, QuestionStatus, Verdict, WrittenQuestion,
};
pub use source_kind::{Detected, SourceKind, SourceOrigin, is_raster, mime, sniff};
pub use srs::{Memory, Rating, ReviewPreferences};
pub use text_enum::UnknownCode;

/// Used by the macros; not part of the API.
#[doc(hidden)]
pub mod __private {
    pub use rusqlite;
    pub use serde;

    pub use crate::text_enum::distinct;
}
