//! Element ids of Home. Per-row ids pair a name with a database id.

pub const NEW_SESSION: usize = 7000;
pub const ADD_FILES: usize = 7001;
pub const NEW_PROJECT: usize = 7002;
pub const OPEN_PIPELINES: usize = 7003;
pub const OPEN_LIBRARY: usize = 7004;
pub const SEE_COMPUTER: usize = 7005;
pub const SCROLL: usize = 7006;
pub const QUICK_SESSION: usize = 7007;
pub const REVIEW_DUE: usize = 7008;
pub const PRACTISE: usize = 7009;
/// The way to Settings › Transcription while its model is not downloaded.
pub const SET_UP_TRANSCRIPTION: usize = 7031;
/// The recent files' grid, which remembers how many columns fit.
pub const RECENT_FILES: usize = 7020;
/// The nearest exam's countdown, which opens the flashcard reviews.
pub const EXAM: usize = 7030;
/// Base of the headline numbers; each adds its place in the row.
pub const STAT: usize = 7010;
/// Base of the sections' entrance animations; each adds its place on the page.
pub const SECTION: usize = 7100;
pub const SESSION_ROW: &str = "session-row";
pub const FILE: &str = "file";
pub const JOB: &str = "job";
