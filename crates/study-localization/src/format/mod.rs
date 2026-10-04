//! Copy built around a value rather than looked up, one file per topic.
//!
//! | Module | Formats |
//! |---|---|
//! | `counts` | how many of something: files, sources, sessions, replies, cards, reviews, tasks, CPU threads, model copies, steps, days to an exam, quiz questions and scores |
//! | `quantities` | sizes, memory, speeds, percentages and measured seconds, with the locale's decimal separator |
//! | `time` | ages, durations, clocks, dates and timestamps, and the file names they date |
//! | `text` | text values put together: lists, breadcrumbs, quiz choices, material and mistake-set titles, file names |
//! | `anchors` | places in a source: `anchor_label` and `citation_label` |
//! | `mentions` | `@study` and tools in session notes, as typed and read in the locale |
//!
//! A formatter only arranges words around values: a fixed word it places, such as `Today`,
//! is a [`Message`](crate::Message) looked up with [`text`](crate::text), so it reads the
//! same wherever it appears.
//!
//! Every public formatter is re-exported from the crate root.

mod anchors;
mod counts;
mod mentions;
mod quantities;
mod text;
mod time;

pub use anchors::{anchor_label, citation_label};
pub use counts::{
    PracticeFigure, card_count, cards_due, cards_due_noun, cards_reviewed, cards_turned, copies,
    cpu_thread_count, days_in_a_row, delete_entry_versions, exam_countdown, file_count, outdated,
    practice_figure, practice_score, project_count, question_number, reply_count, results_ready,
    review_progress, reviews_this_week, session_count, source_count, step_of, steps_on,
};
pub use mentions::{mention_label, mention_suggestions};
pub use quantities::{
    bandwidth, gflops, media_size, memory_free, memory_gib, memory_size, seconds_taken, with_size,
    zoom_percentage,
};
pub use text::{
    breadcrumb, choice_label, choice_letter, counted, joined, listed, material_file_name,
    mistakes_title, operating_system, recommended_model, separator,
};
pub use time::{
    age, ago, day_label, job_duration, moment, pasted_image_name, recording_clock,
    recording_file_name, recording_moment, status_with_duration, time_of_day,
};
