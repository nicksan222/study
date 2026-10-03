//! Glue between the pages and `study-app`: small rules and actions the pages share that are
//! not presentation. Nothing here draws; the pages in `ui::screens` do. This shrinks as
//! `study-app` grows.
//!
//! - `benchmark`: measuring this computer once, on first launch.
//! - `clock`: stored times shown on this computer's clock.
//! - `dashboard`: everything Home shows, read in one go.
//! - `display`: the zoom steps and their shortcuts.
//! - `errors`: logging a failure the page explains in its own words.
//! - `jobs`: background jobs in plain words (`Problem`, labels, elapsed time).
//! - `llm`: the connection check the Language models settings offer.
//! - `markdown`: markdown as models write it, split into lines and marks for display.
//! - `media`: file previews, attachment summaries, and each source kind's icon.
//! - `progress`: how a student is doing with a project's flashcards, by day.
//! - `recording`: the microphone thread.
//! - `search`: the search palette's small rules.
//! - `sessions`: a new session's provisional title, and a message's words to copy.

pub mod benchmark;
pub mod clock;
pub mod dashboard;
pub mod display;
pub mod errors;
pub mod jobs;
pub mod llm;
pub mod markdown;
pub mod media;
pub mod progress;
pub mod recording;
pub mod search;
pub mod sessions;
