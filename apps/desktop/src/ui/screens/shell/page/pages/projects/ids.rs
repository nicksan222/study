//! Element ids of the Projects page. Its sidebar also shows sessions, whose ids live in
//! `sessions::ids`.

/// The sidebar's new-project button.
pub const SIDEBAR_NEW: usize = 1200;
/// Creates or renames, from the editor.
pub const SAVE: usize = 1203;
pub const CANCEL_EDIT: usize = 1204;
pub const RENAME: usize = 1205;
pub const DELETE: usize = 1206;
pub const CONFIRM_DELETE: usize = 1207;
pub const CANCEL_DELETE: usize = 1208;
pub const VIEW_FILES: usize = 1211;
pub const VIEW_SESSIONS: usize = 1212;
pub const OPEN_STUDY: usize = 1213;
/// A project's piece of material, one row per kind; the id is the kind's place in `ArtifactKind::ALL`.
pub const MATERIAL_ROW: &str = "project-material";
pub const OPEN_QUIZ: usize = 1214;
/// The project name being edited, and the name of a project being created.
pub const NAME_INPUT: &str = "project-name";
pub const CREATE_INPUT: &str = "new-project-name";
/// The exam day's picker.
pub const EXAM_DAY: &str = "exam-day";
