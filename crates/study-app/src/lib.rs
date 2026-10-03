//! The service the Study UI talks to. [`App`] owns the one database store, the one Tokio
//! runtime, the event bus and the background jobs; the UI calls its commands and queries
//! and renders the plain data they return.
//!
//! `impl App` is split by area; each file holds one group of methods:
//!
//! | File               | `App` methods for                                                |
//! |--------------------|------------------------------------------------------------------|
//! | `app.rs`           | Opening, the database, the runtime (`spawn`) and the bus          |
//! | `app/workers.rs`   | Starting work, job handlers, queueing, deleting, catch-up        |
//! | `library.rs`       | Projects, sources, their documents, notes and links              |
//! | `previews.rs`      | Bounded pictures and text of a source                            |
//! | `sessions.rs`      | Sessions, posting messages, recordings, titles                   |
//! | `material.rs`      | Study material, and reviewing flashcards                         |
//! | `practice.rs`      | Practice: one endless quiz per project, and answering it         |
//! | `jobs.rs`          | The jobs overview, stopping and retrying jobs                    |
//! | `searching.rs`     | Searching everything                                             |
//! | `settings.rs`      | Preferences, connections, processing switches, the machine report |
//! | `models.rs`        | Installing local models, and retrying work that waited for one   |
//! | `chatgpt.rs`       | Signing in to ChatGPT, and retrying work that waited for it      |
//!
//! Background work runs one `JobHandler` per `JobKind`. The processing pipeline (fetching
//! links, reading, refining, indexing, embedding, and the enhancers that make study
//! material) is `study_pipeline::Pipeline`, registered in `app/workers.rs`. The rest of the
//! crate's own modules:
//!
//! | File               | What it holds                                                    |
//! |--------------------|------------------------------------------------------------------|
//! | [`search`]         | Ranking and retrieval over the index the pipeline keeps          |
//! | `agents/`          | Agents: the `Title`, `Reply`, `Question` and `Grade` jobs        |
//!
//! Besides `App` and what its methods take and return ([`WorkerSetup`], [`LocalModel`],
//! [`Preview`], [`has_preview`]), the UI uses: [`views`], the data it renders; [`events`],
//! what it listens to; [`benchmark`], this computer's measurements; [`chat`], [`stt`] and
//! [`vision`], each capability's settings and setup; [`choice`] and
//! [`preferences`](mod@preferences), for the settings it declares itself; and [`pipeline`],
//! for tests that replace the real processors.
//!
//! Every method that touches the database blocks: call it from a background task, never the
//! UI thread.

mod agents;
mod app;
mod chatgpt;
mod jobs;
mod library;
mod material;
mod models;
mod practice;
mod previews;
pub mod search;
mod searching;
mod sessions;
mod settings;

pub use app::{App, WorkerSetup};
pub use models::LocalModel;
pub use previews::{Preview, has_preview};

/// The data the UI renders.
pub mod views {
    pub use study_core::db::{
        Answered, Artifact, CardChange, Changes, ChatMessage, ChatSession, DueCard, Job,
        JobOverview, JobTarget, MAX_RECORDING_SAMPLES, MessagePart, MessageRole, MessageStatus,
        PartContent, Place, Practice, PracticeQuestion, PracticeScore, PracticeSummary, Project,
        RECORDING_SAMPLE_RATE, Recording, SearchHit, SearchKind, SearchTarget, Source, Thread,
        ThreadSummary, TitleSource,
    };
    pub use study_core::{
        Anchor, ArtifactBody, ArtifactKind, ArtifactStatus, Block, BlockKind, Citation, Document,
        DocumentMeta, Flashcard, JobKind, JobStatus, Memory, PracticeAnswer, PracticeBody,
        QuestionKind, QuestionStatus, Rating, Verdict, WrittenQuestion,
    };
}

/// What the UI listens to. Events say when to look again; the data comes from queries.
pub mod events {
    pub use study_core::bus::{EventBus, Heard, Listener};
    pub use study_core::db::{JobEvent, MessageEvent};
}

/// The processing pipeline and its processors, for tests that replace the real ones.
pub use study_pipeline as pipeline;

/// Settings declared by the UI itself use these, like every other crate's.
pub use study_core::{choice, preferences};

/// This computer's measurements, and what they mean for each model ([`Report::plan`](benchmark::Report::plan)).
pub mod benchmark {
    pub use study_ai::catalog::{HEADROOM_BYTES, Placement, Plan, Reason};
    pub use study_ai::hardware::{ComputeScore, Report, SystemInfo};
}

/// Each capability's settings and setup, for the Settings pages.
pub use study_ai::{chat, stt, vision};

/// Signed application updates distributed through GitHub Releases.
pub use study_ai::updates;
