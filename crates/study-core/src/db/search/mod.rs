//! What search looks through: passages of every document with their embeddings, and the
//! names and messages people typed. Chunking, embedding and ranking live with the callers;
//! this module only stores and looks up.
//!
//! | File          | What it holds                                                               |
//! |---------------|-----------------------------------------------------------------------------|
//! | `mod.rs`      | The records                                                                 |
//! | `passages.rs` | `chunks` and `embeddings`: storing passages, embedding them, reading back   |
//! | `find.rs`     | Keyword (`chunks_fts`, `message_fts`) and name lookups, and [`SearchHit`]s  |

mod find;
mod passages;
#[cfg(test)]
mod tests;

use crate::{Anchor, ProjectId, SessionId, SourceId, SourceKind};

crate::text_enum! {
    /// What a search result is.
    pub enum SearchKind {
        Project = "project",
        Session = "session",
        /// The text of a chat message: its active version, not the versions it replaced.
        Message = "message",
        /// A source, found by its name or by a passage of its text.
        Source = "source",
    }
}

/// Where opening a search result leads.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SearchTarget {
    Project(ProjectId),
    Session {
        project_id: ProjectId,
        session_id: SessionId,
    },
    /// A source, at the place the passage came from when the hit is a passage.
    Source {
        source_id: SourceId,
        anchor: Option<Anchor>,
        /// The latest conversation it is attached to, where it opens beside the chat.
        session_id: Option<SessionId>,
    },
}

/// One result, ready to show.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SearchHit {
    pub kind: SearchKind,
    pub title: String,
    /// Where it lives, such as the project of a session.
    pub context: Option<String>,
    /// The matching passage or message.
    pub excerpt: Option<String>,
    /// What kind of file a source is.
    pub file_kind: Option<SourceKind>,
    /// When it was last touched, in seconds since the Unix epoch: when a message was sent,
    /// a project or session last changed, or a source was added.
    pub at: i64,
    pub target: SearchTarget,
}

/// A passage of a document, before it is stored.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkDraft {
    /// Ordinals of the first and last block it covers.
    pub first_block: u32,
    pub last_block: u32,
    pub anchor: Anchor,
    pub text: String,
}

/// A passage text still without an embedding from some model.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingPassage {
    pub content_hash: [u8; 32],
    pub text: String,
}
