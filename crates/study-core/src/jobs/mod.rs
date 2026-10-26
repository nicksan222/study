//! The engine that runs background work. Work is stored as [`Job`](crate::db::Job) rows, so
//! nothing is lost when the app quits; the engine claims queued jobs and runs each through
//! the [`JobHandler`] registered for its kind. It knows nothing about what any kind does.
//!
//! - A handler returns follow-up jobs, stored in the same transaction that marks its job
//!   done, so a chain such as read → index → embed never breaks.
//! - Retryable failures ([`ErrorKind::is_retryable`](crate::ErrorKind::is_retryable))
//!   are tried again with exponential backoff, honouring `Retry-After`.
//! - Cancelling marks the job in the database first, then stops its task.
//! - Every change is announced as a [`JobEvent`](crate::db::JobEvent); the UI reloads from
//!   the database, so a missed event loses nothing.
//! - Lanes cap how much of each kind of work runs at once (see [`Lane`]).

mod engine;
mod failures;

pub use engine::{JobHandler, Jobs, Lane};
pub use failures::{off_thread, wrong_target};
/// What a [`JobHandler`] returns.
pub use futures::future::BoxFuture;
