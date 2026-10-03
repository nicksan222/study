//! Element ids of the sessions page. Per-row ids pair a name with the row's database id;
//! only a project's sidebar group adds its id to a base far above every other page's ids,
//! since the group derives the ids of its parts from one number.

// The page and the composer.
pub const ATTACH: usize = 3001;
pub const SEND: usize = 3002;
pub const PROJECT_PICKER: usize = 3003;
pub const DELETE: usize = 3004;
pub const CONFIRM_DELETE: usize = 3005;
pub const CANCEL_DELETE: usize = 3006;
pub const RETRY_LOAD: usize = 3007;
pub const GO_TO_PROJECTS: usize = 3008;
pub const TRANSCRIPT_SCROLL: usize = 3009;
pub const REGENERATE_TITLE: usize = 3013;
pub const JUMP_TO_LATEST: usize = 3024;
/// Base of the composer's attachment chips; each adds its place.
pub const REMOVE_ATTACHMENT: usize = 3100;

// The microphone.
pub const RECORD: usize = 3014;
pub const RESUME_RECORDING: usize = 3015;
pub const SEND_RECORDING: usize = 3016;
pub const DISCARD_RECORDING: usize = 3017;

// The side panel for an attached file.
pub const DETAIL_SCROLL: usize = 3010;
pub const DETAIL_CLOSE: usize = 3011;
pub const DETAIL_OPEN: usize = 3012;
pub const DETAIL_MOTION: usize = 3025;
pub const DETAIL_COPY: &str = "detail-copy";
/// A block of read text; the id packs the source's id and the block's place.
pub const DETAIL_CORRECT: &str = "detail-correct";
pub const DETAIL_CANCEL_CORRECTION: &str = "detail-cancel-correction";
pub const DETAIL_SAVE_CORRECTION: &str = "detail-save-correction";
pub const DETAIL_RETRY: &str = "detail-retry";
pub const DETAIL_STOP: &str = "detail-stop";
/// Back to the top of a file's read text, after a citation opened it at its passage.
pub const DETAIL_FROM_START: &str = "detail-from-start";

// The thread under an attachment.
pub const THREAD_SCROLL: usize = 3018;
pub const THREAD_CLOSE: usize = 3019;
pub const THREAD_ATTACH: usize = 3020;
pub const THREAD_SEND: usize = 3021;
/// The tools menu of the page's composer and of the thread's.
pub const ASK: usize = 3022;
pub const THREAD_ASK: usize = 3023;
/// Base of the thread composer's attachment chips; each adds its place.
pub const THREAD_REMOVE_ATTACHMENT: usize = 3200;
/// Opens an attachment's thread; adds the attachment's part id.
pub const OPEN_THREAD: &str = "open-thread";
/// A mention offered while one is typed, in the page's composer or the thread's; adds its
/// place in the offer.
pub const MENTION_SUGGESTION: &str = "mention-suggestion";
pub const THREAD_MENTION_SUGGESTION: &str = "thread-mention-suggestion";

// Messages, their attachments and jobs.
pub const ATTACHMENT: &str = "attachment";
/// A source cited by an answer; the id packs the message's id and the citation's marker.
pub const ANSWER_CITATION: &str = "answer-citation";
/// An answer's words, whose citation markers open what they cite; adds the part's id.
pub const ANSWER_TEXT: &str = "answer-text";
pub const ANSWER_SETTINGS: &str = "answer-settings";
pub const ATTACHMENT_DETAILS: &str = "attachment-details";
pub const OPEN_ATTACHMENT: &str = "open-attachment";
pub const RETRY_JOB: &str = "retry-job";
pub const EXPAND_JOB: &str = "expand-job";
/// The sweep over a running job's words, paired with the job.
pub const JOB_SHIMMER: &str = "job-shimmer";
/// Deleting a note or an answer, and confirming or cancelling it; each adds the message's id.
pub const DELETE_MESSAGE: &str = "delete-message";
pub const CONFIRM_DELETE_MESSAGE: &str = "confirm-delete-message";
pub const CANCEL_DELETE_MESSAGE: &str = "cancel-delete-message";
/// Copies what a note or an answer says; adds the message's id.
pub const COPY_MESSAGE: &str = "copy-message";
/// Where a note fell in its session's recording, opening it there; adds the message's id.
pub const RECORDING_LINK: &str = "recording-link";
/// Asks for a finished answer again, as a new version; adds the message's id.
pub const REANSWER: &str = "reanswer";
/// The floating bar of what can be done with an entry, shown over it; adds the message's id.
pub const ACTION_BAR: &str = "action-bar";
/// The switcher between an entry's versions: its arrows, each adding the message's id.
pub const VERSION_SWITCHER: &str = "version-switcher";
pub const VERSION_PREVIOUS: &str = "version-previous";
pub const VERSION_NEXT: &str = "version-next";
/// The AI edit menu: its button, the two ready-made rewrites, the instruction, and running
/// it; each adds the message's id.
pub const AI_EDIT: &str = "ai-edit";
/// The place around the AI edit button that takes focus back when its menu closes.
pub const AI_EDIT_SLOT: &str = "ai-edit-slot";
/// The AI edit menu's own popover.
pub const AI_MENU: &str = "ai-menu";
pub const AI_IMPROVE: &str = "ai-improve";
pub const AI_SUMMARIZE: &str = "ai-summarize";
pub const AI_INSTRUCTION: &str = "ai-instruction";
pub const AI_RUN: &str = "ai-run";
/// Editing an entry's text in place: opening it, its text, and saving or cancelling; each
/// adds the message's id.
pub const EDIT_MESSAGE: &str = "edit-message";
pub const EDIT_TEXT: &str = "edit-text";
pub const SAVE_EDIT: &str = "save-edit";
pub const CANCEL_EDIT: &str = "cancel-edit";
/// Stops the version being written; adds the message's id.
pub const STOP_VERSION: &str = "stop-version";
/// The version being written, named beside the switcher; adds the message's id.
pub const VERSION_WRITING: &str = "version-writing";
/// Why a version could not be asked for, or what an edit left unchanged; adds the message's id.
pub const VERSION_NOTICE: &str = "version-notice";
pub const COPY_JOB: &str = "copy-job";

// The Projects sidebar, where sessions are listed under their project.
/// Base of a project's group; adds the project's id.
pub const PROJECT: usize = 9_000_000;
pub const PROJECT_DETAILS: &str = "project-details";
pub const PROJECT_NEW_SESSION: &str = "project-new-session";
pub const DRAFT_SESSION: &str = "draft-session";
pub const SESSION: &str = "session";
/// The open session's page, where files dropped from outside are attached.
pub const DROP_TARGET: usize = 3026;
/// The thread's side panel, where files dropped from outside go to its reply.
pub const THREAD_DROP_TARGET: usize = 3027;
/// A new session's ways to start: record, add files, ask the assistant.
pub const START_RECORDING: usize = 3028;
pub const START_FILES: usize = 3029;
pub const START_ASK: usize = 3030;
/// The page's composer: its editor, which holds the text box, found the same way every run.
pub const COMPOSER: &str = "composer";
/// The thread's composer.
pub const THREAD_COMPOSER: &str = "thread-composer";
/// The text of a correction being written.
pub const CORRECTION: &str = "correction";
