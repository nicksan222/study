//! What the sessions page draws, one file per piece.
//!
//! | File | Draws |
//! |---|---|
//! | `conversation.rs` | an open session: the transcript, the composer, the side panel |
//! | `draft.rs` | the draft of a new session: its project, a heading, ways to start, the composer |
//! | `notices.rs` | what shows instead of a conversation, and the error line |
//! | `message.rs` | one entry of the notebook: a note with its files, or an answer and what a tool made, its time and actions in the margin |
//! | `attachment.rs` | an attached file as one line, and the work on it folded under it |
//! | `composer.rs` | the message box, its buttons, and what waits above its text |
//! | `mentions.rs` | mentions as chips, the picker that offers them, the tools menu |
//! | `recording.rs` | the microphone, the live recording and unfinished ones |
//! | `panel.rs` | how a side panel appears beside the conversation |
//! | `detail.rs` | the side panel for one file, where its read text is corrected |
//! | `thread.rs` | the side panel for an attachment's thread, with its own composer |

mod attachment;
mod composer;
mod conversation;
mod detail;
mod draft;
mod mentions;
mod message;
mod notices;
mod panel;
mod recording;
mod thread;

pub(super) use attachment::{Attached, ThreadLink, nothing_read, source_card};
pub(super) use composer::{pending_files, send_button, with_context};
pub(super) use detail::{CorrectionState, Detail, detail_panel};
pub(super) use mentions::{
    MentionPicker, ask_button, chip_mentions, insert_mention, marked_note, mention_picker,
};
pub(super) use message::{META_GUTTER, RowMarks, message_row};
pub(super) use panel::{Panel, reveal};
pub(super) use recording::RecordingState;
pub(super) use thread::ThreadState;
