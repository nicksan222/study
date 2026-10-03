//! Element ids of the Quiz page. Per-row ids pair a name with a database id.

pub const SUBMIT: usize = 7202;
pub const NEXT: usize = 7203;
pub const RETRY_LOAD: usize = 7204;
pub const DELETE: usize = 7205;
pub const RETRY_JOB: &str = "practice-retry-job";
pub const SETTINGS: &str = "practice-job-settings";
pub const CONFIRM_DELETE: usize = 7208;
pub const CANCEL_DELETE: usize = 7209;
pub const ADD_CARD: usize = 7210;
/// The verdict on the question on screen, named by the verdict and why.
pub const VERDICT: usize = 7212;
/// A project in the sidebar; opens its quiz.
pub const PROJECT: &str = "practice-project";
/// A choice of the question on screen; adds its place (0 for A), the same on every question.
pub const CHOICE: &str = "practice-choice";
/// A row of the results, which opens to show how the question went; adds the question's
/// number as the row shows it (1 for the first question).
pub const RESULT: &str = "practice-result";
/// A source a question cites; the id packs the question's id and the citation's marker.
pub const CITATION: &str = "practice-citation";
/// The open answer being written.
pub const ANSWER: &str = "practice-answer";
