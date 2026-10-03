//! Sample data: five courses as a student would have them, written into a [`Database`] so
//! every screen has something real to show. A development tool, never a dependency of the
//! app: `just reset-data` runs the `study-seed` binary, the showcase records its GIF on
//! [`showcase`], and tests call [`demo`] or [`showcase`] on a database they own.
//!
//! The words are in `courses.rs`, the small real files they attach in `files.rs`, and
//! `writer.rs` says what is written and how. The writer goes through [`Database`]'s own
//! methods, plus the few narrowly named ones `study-core` offers under its `testing` feature
//! for dates and job outcomes no running app can produce.
//!
//! `main.rs` seeds the development database if it is empty.

use study_core::{Result, db::Database};

mod courses;
mod files;
mod writer;

/// Fills an empty database with sample courses, sessions, files, study material and a quiz,
/// showing every status. Returns `false`, changing nothing, when there are already projects.
pub fn demo(database: &Database) -> Result<bool> {
    writer::write(database, writer::Sample::Development)
}

/// Like [`demo`], but for showing the app: every file is read, every course has up-to-date
/// notes, flashcards and a diagram, and no work is left to run but the indexing of what was
/// read (the pipeline writes the passages), so no screen shows a failure or an update to
/// make.
pub fn showcase(database: &Database) -> Result<bool> {
    writer::write(database, writer::Sample::Showcase)
}
