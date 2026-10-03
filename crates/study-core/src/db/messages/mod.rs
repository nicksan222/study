//! Session messages: ordered text and source parts inside a session.
//!
//! A session is a log of what the student writes down and attaches, not a chat: posting a
//! message queues the reads of its files and, while the session's title is provisional, the
//! job that names it. Only a message that mentions the assistant
//! ([`Mention::Assistant`](crate::Mention::Assistant)) gets an answer: posting it also
//! stores a pending assistant message and the reply job that writes it, once the message's
//! files are read. Study material is not made from a message: it is made from the whole
//! project (see `artifacts.rs`).
//!
//! Every message lives in one [`Place`]: the session's timeline, or the [`Thread`] under an
//! attachment of a timeline message, as in a chat app. A thread opens with the attachment
//! and what was read from it; its replies are ordinary messages, so notes, files and answers
//! work the same in both.
//!
//! | File          | What it holds                                                           |
//! |---------------|-------------------------------------------------------------------------|
//! | `mod.rs`      | The records, reading messages by [`Scope`], writing an answer, deleting |
//! | `post.rs`     | [`Database::post_message`]: parts, attachments and the jobs they need   |
//! | `material.rs` | [`ProjectMaterial`]: the files and notes a project's sessions hold      |
//! | `thread.rs`   | [`Thread`] and [`ThreadSummary`]: the replies under an attachment       |

mod material;
mod post;
#[cfg(test)]
mod tests;
mod thread;

pub use material::ProjectMaterial;
pub(in crate::db) use material::project_material_of;
pub use thread::{Thread, ThreadSummary};

pub(in crate::db) use post::{MAX_NOTES_CHARS, latest_notes};

use super::citations::{CitedBy, replace_citations};
use super::jobs::{JobTarget, NewJob, enqueue};
use super::{Database, Job, trimmed};
use crate::Result;
use crate::{
    Citation, Document, JobId, JobKind, MessageId, PartId, RecordingId, SessionId, SourceId,
    SourceKind,
};
use rusqlite::{Row, params};
use std::{collections::HashMap, path::PathBuf};
use thread::thread_summaries_in;

const MAX_TEXT_CHARS: usize = 100_000;

crate::text_enum! {
    pub enum MessageRole {
        User = "user",
        Assistant = "assistant",
    }
}

crate::text_enum! {
    pub enum MessageStatus {
        /// An answer waiting for its reply job to start.
        Pending = "pending",
        /// An answer being written.
        Writing = "writing",
        Complete = "complete",
    }
}

crate::text_enum! {
    /// Which [`PartContent`] a `message_parts` row holds: the tag its columns are read by.
    pub(in crate::db) enum PartKind {
        Text = "text",
        Source = "source",
    }
}

/// A stored message with everything a session page shows about it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatMessage {
    pub id: MessageId,
    pub session_id: SessionId,
    pub role: MessageRole,
    pub status: MessageStatus,
    /// The user message an assistant message answers.
    pub reply_to: Option<MessageId>,
    /// The attachment whose thread holds this message; `None` on the session's timeline.
    pub thread_root: Option<PartId>,
    /// For a note written while its session was being recorded: how far into that
    /// recording, in milliseconds.
    pub recording_ms: Option<u64>,
    /// The file of that recording, once it was posted.
    pub recorded_in: Option<SourceId>,
    pub created_at: i64,
    pub parts: Vec<MessagePart>,
    /// The passages an assistant message cites, by marker.
    pub citations: Vec<Citation>,
    /// The latest job writing an assistant message, which says how writing went.
    pub reply: Option<Job>,
}

/// One part of a message, with the reading of the source it shows.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessagePart {
    pub id: PartId,
    pub content: PartContent,
    /// The jobs that read the source this part shows, oldest first.
    pub jobs: Vec<Job>,
    /// The text read from that source, once it has been read.
    pub document: Option<Document>,
    /// The replies in this attachment's thread, when its message is on the timeline.
    pub thread: ThreadSummary,
}

/// What a part shows.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PartContent {
    Text(String),
    /// `source_id` is `None` once the source has been deleted; its name and kind stay.
    Source {
        source_id: Option<SourceId>,
        name: String,
        kind: SourceKind,
    },
}

impl PartContent {
    /// The source this part shows, while it still exists.
    pub fn source_id(&self) -> Option<SourceId> {
        match self {
            Self::Source { source_id, .. } => *source_id,
            Self::Text(_) => None,
        }
    }
}

/// Whether Study can read a source of a sniffed kind and media type; readable sources get a
/// job that reads them.
pub type Readable<'a> = &'a dyn Fn(SourceKind, &str) -> bool;

/// Reads nothing, for sources that should only be stored: sample data and tests.
#[cfg(any(test, feature = "testing"))]
pub fn read_nothing(_: SourceKind, _: &str) -> bool {
    false
}

/// Where a message is posted: a session's timeline, or a thread in it.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Place {
    Timeline(SessionId),
    /// The thread under an attachment of a timeline message.
    Thread(PartId),
}

impl From<SessionId> for Place {
    fn from(session: SessionId) -> Self {
        Self::Timeline(session)
    }
}

/// Which messages a query reads: a condition on `messages m`, with its key bound as `?1`.
#[derive(Clone, Copy, Debug)]
pub(in crate::db) enum Scope {
    /// A session's timeline, without its threads.
    Timeline(SessionId),
    /// The replies in the thread under an attachment.
    Thread(PartId),
    Message(MessageId),
}

impl Scope {
    pub(in crate::db) fn condition(self) -> &'static str {
        match self {
            Self::Timeline(_) => "m.session_id = ?1 AND m.thread_root IS NULL",
            Self::Thread(_) => "m.thread_root = ?1",
            Self::Message(_) => "m.id = ?1",
        }
    }

    pub(in crate::db) fn key(self) -> i64 {
        match self {
            Self::Timeline(id) => id.get(),
            Self::Thread(id) => id.get(),
            Self::Message(id) => id.get(),
        }
    }
}

/// A part to store.
#[derive(Clone, Debug)]
pub enum NewPart {
    Text(String),
    /// A local file attached under the session's project.
    File(PathBuf),
    /// One of the session's [`Recording`](super::Recording)s, which becomes a WAV source
    /// named `name` under the session's project.
    Recording {
        id: RecordingId,
        name: String,
    },
}

impl Database {
    /// A session's timeline, oldest first, with each part's jobs, document and thread. The
    /// replies in its threads are read with [`thread`](Self::thread).
    pub fn list_messages(&self, session_id: SessionId) -> Result<Vec<ChatMessage>> {
        self.load(Scope::Timeline(session_id))
    }

    /// One message of any session or thread, with its parts, citations and reply job.
    pub fn message(&self, id: MessageId) -> Result<Option<ChatMessage>> {
        Ok(self.load(Scope::Message(id))?.pop())
    }

    /// The messages in `scope`, oldest first, with everything a session page shows.
    fn load(&self, scope: Scope) -> Result<Vec<ChatMessage>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT m.id, m.session_id, m.role, m.status, m.reply_to, m.thread_root, m.created_at,
                    m.recording_ms, m.recorded_in
             FROM messages m WHERE {} ORDER BY m.id",
            scope.condition()
        ))?;
        let mut messages = statement
            .query_map(params![scope.key()], ChatMessage::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let positions: HashMap<MessageId, usize> = messages
            .iter()
            .enumerate()
            .map(|(index, message)| (message.id, index))
            .collect();

        let parts = self.parts_in(scope)?;
        let sources: Vec<SourceId> = parts
            .iter()
            .filter_map(|(_, (_, content))| content.source_id())
            .collect();
        let jobs = self.extract_jobs_by_source(&sources)?;
        let mut threads = thread_summaries_in(&self.connection, scope)?;
        for (message_id, (id, content)) in parts {
            let Some(&index) = positions.get(&message_id) else {
                continue;
            };
            let (jobs, document) = match content.source_id() {
                Some(source) => (
                    jobs.get(&source).cloned().unwrap_or_default(),
                    self.document_of(source)?.map(|(_, document)| document),
                ),
                None => (Vec::new(), None),
            };
            messages[index].parts.push(MessagePart {
                id,
                content,
                jobs,
                document,
                thread: threads.remove(&id).unwrap_or_default(),
            });
        }

        let mut replies = self.reply_jobs_in(scope)?;
        let mut citations = self.citations_in(scope)?;
        for message in &mut messages {
            message.reply = replies.remove(&message.id);
            message.citations = citations.remove(&message.id).unwrap_or_default();
        }
        Ok(messages)
    }

    /// Asks for a finished answer in words again: it goes back to pending, keeping its words
    /// and citations until [`finish_reply`](Self::finish_reply) replaces them, and a new
    /// reply job writes it. `None` when no finished answer has this id.
    pub fn reanswer(&self, id: MessageId) -> Result<Option<JobId>> {
        let tx = self.immediate()?;
        let changed = tx.execute(
            "UPDATE messages SET status = 'pending'
             WHERE id = ?1 AND role = 'assistant' AND status = 'complete'",
            params![id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        let job = enqueue(&tx, &NewJob::new(JobKind::Reply, JobTarget::Message(id)))?;
        tx.commit()?;
        Ok(Some(job))
    }

    /// Marks an assistant message as being written. What an earlier attempt stored stays
    /// until [`finish_reply`](Self::finish_reply) replaces it. Returns `false` when there is no
    /// such answer.
    pub fn begin_reply(&self, id: MessageId) -> Result<bool> {
        let changed = self.connection.execute(
            "UPDATE messages SET status = 'writing'
             WHERE id = ?1 AND role = 'assistant' AND status != 'complete'",
            params![id],
        )?;
        Ok(changed != 0)
    }

    /// Stores an assistant message's answer and the passages it cites, and marks it
    /// complete, in one transaction. Returns `false` when the message is gone.
    pub fn finish_reply(&self, id: MessageId, text: &str, citations: &[Citation]) -> Result<bool> {
        let text = normalize_text(text)?;
        let tx = self.immediate()?;
        let changed = tx.execute(
            "UPDATE messages SET status = 'complete' WHERE id = ?1 AND role = 'assistant'",
            params![id],
        )?;
        if changed == 0 {
            return Ok(false);
        }
        tx.execute(
            "DELETE FROM message_parts WHERE message_id = ?1",
            params![id],
        )?;
        tx.execute(
            "INSERT INTO message_parts (message_id, ordinal, kind, text) VALUES (?1, 0, ?2, ?3)",
            params![id, PartKind::Text, text],
        )?;
        replace_citations(&tx, CitedBy::Message(id), citations)?;
        tx.commit()?;
        Ok(true)
    }

    /// Returns `false` when no message has this `id`. Attached sources stay in the Library.
    pub fn delete_message(&self, id: MessageId) -> Result<bool> {
        let changed = self
            .connection
            .execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        Ok(changed != 0)
    }

    /// Every part in `scope`, with its message, in message and part order.
    fn parts_in(&self, scope: Scope) -> Result<Vec<(MessageId, (PartId, PartContent))>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT p.message_id, p.id, p.kind, p.text, p.source_id, p.source_name, p.source_kind
             FROM message_parts p
             JOIN messages m ON m.id = p.message_id
             WHERE {}
             ORDER BY p.message_id, p.ordinal",
            scope.condition()
        ))?;
        let parts = statement
            .query_map(params![scope.key()], |row| {
                Ok((row.get::<_, MessageId>(0)?, part_from_row(row, 1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(parts)
    }

    /// Every citation in `scope`, by message, in marker order.
    fn citations_in(&self, scope: Scope) -> Result<HashMap<MessageId, Vec<Citation>>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT c.message_id, c.marker, c.source_id, c.source_name, c.anchor, c.quote
             FROM citations c JOIN messages m ON m.id = c.message_id
             WHERE {}
             ORDER BY c.message_id, c.marker",
            scope.condition()
        ))?;
        let mut grouped: HashMap<MessageId, Vec<Citation>> = HashMap::new();
        let rows = statement.query_map(params![scope.key()], |row| {
            Ok((row.get::<_, MessageId>(0)?, Citation::from_row(row, 1)?))
        })?;
        for row in rows {
            let (message, citation) = row?;
            grouped.entry(message).or_default().push(citation);
        }
        Ok(grouped)
    }
}

impl ChatMessage {
    /// Maps `id, session_id, role, status, reply_to, thread_root, created_at, recording_ms,
    /// recorded_in`, without parts.
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(ChatMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            status: row.get(3)?,
            reply_to: row.get(4)?,
            thread_root: row.get(5)?,
            created_at: row.get(6)?,
            recording_ms: row.get::<_, Option<i64>>(7)?.map(|ms| ms.max(0) as u64),
            recorded_in: row.get(8)?,
            parts: Vec::new(),
            citations: Vec::new(),
            reply: None,
        })
    }
}

/// Maps `id, kind, text, source_id, source_name, source_kind` starting at `offset`.
fn part_from_row(row: &Row, offset: usize) -> rusqlite::Result<(PartId, PartContent)> {
    let id = row.get(offset)?;
    let content = match row.get(offset + 1)? {
        PartKind::Text => PartContent::Text(row.get(offset + 2)?),
        PartKind::Source => PartContent::Source {
            source_id: row.get(offset + 3)?,
            name: row.get(offset + 4)?,
            kind: row.get(offset + 5)?,
        },
    };
    Ok((id, content))
}

/// Trims message text and checks its length.
fn normalize_text(text: &str) -> Result<String> {
    trimmed(text, "message text", MAX_TEXT_CHARS)
}

crate::events! {
    /// What happens to session messages. The database holds the truth; these say when to look.
    pub enum MessageEvent for ChatMessage {
        /// A message and its jobs were stored, on the timeline or in the thread under
        /// `thread_root`.
        Posted {
            session_id: SessionId,
            thread_root: Option<PartId>,
            message_id: MessageId,
        },
    }
}
