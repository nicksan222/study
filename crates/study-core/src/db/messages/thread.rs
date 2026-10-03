//! Threads: the replies under one attachment of a timeline message, as in a chat app. A
//! thread opens with the attachment itself and what was read from it (a transcript,
//! recognized text), then holds ordinary messages: notes, more files, and answers.

use super::super::Database;
use super::{ChatMessage, MessagePart, MessageRole, MessageStatus, PartContent, Scope};
use crate::Result;
use crate::{MessageId, PartId, SessionId};
use rusqlite::{Connection, OptionalExtension as _, params};
use std::collections::HashMap;

/// How much a thread holds, as the attachment it hangs off shows it.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ThreadSummary {
    pub replies: usize,
    /// When the latest reply was posted.
    pub last_reply_at: Option<i64>,
}

/// The thread under one attachment.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Thread {
    pub session_id: SessionId,
    /// The timeline message that attached the file.
    pub message_id: MessageId,
    /// When that message was posted.
    pub opened_at: i64,
    /// The attachment, with its reads and what was read from it: the thread's first element.
    pub root: MessagePart,
    /// Every reply, oldest first.
    pub replies: Vec<ChatMessage>,
}

impl Thread {
    /// The attachment as the student's opening message, so the thread reads as a
    /// conversation that starts with the file.
    pub fn opening(&self) -> ChatMessage {
        ChatMessage {
            id: self.message_id,
            session_id: self.session_id,
            role: MessageRole::User,
            status: MessageStatus::Complete,
            reply_to: None,
            thread_root: None,
            created_at: self.opened_at,
            recording_ms: None,
            recorded_in: None,
            parts: vec![self.root.clone()],
            citations: Vec::new(),
            reply: None,
        }
    }
}

impl Database {
    /// The thread under `root`, or `None` when `root` is not an attachment of a timeline
    /// message (only those start threads, so threads never nest).
    pub fn thread(&self, root: PartId) -> Result<Option<Thread>> {
        let message: Option<MessageId> = self
            .connection
            .query_row(
                "SELECT message_id FROM message_parts WHERE id = ?1",
                params![root],
                |row| row.get(0),
            )
            .optional()?;
        let Some(message) = message.map(|id| self.message(id)).transpose()?.flatten() else {
            return Ok(None);
        };
        if message.thread_root.is_some() {
            return Ok(None);
        }
        let Some(part) = message.parts.into_iter().find(|part| part.id == root) else {
            return Ok(None);
        };
        if !matches!(part.content, PartContent::Source { .. }) {
            return Ok(None);
        }
        Ok(Some(Thread {
            session_id: message.session_id,
            message_id: message.id,
            opened_at: message.created_at,
            root: part,
            replies: self.load(Scope::Thread(root))?,
        }))
    }
}

/// The threads under the attachments of the messages in `scope`, by attachment.
pub(super) fn thread_summaries_in(
    connection: &Connection,
    scope: Scope,
) -> Result<HashMap<PartId, ThreadSummary>> {
    let mut statement = connection.prepare(&format!(
        "SELECT r.thread_root, count(*), max(r.created_at)
         FROM messages r
         JOIN message_parts p ON p.id = r.thread_root
         JOIN messages m ON m.id = p.message_id
         WHERE {}
         GROUP BY r.thread_root",
        scope.condition()
    ))?;
    let summaries = statement
        .query_map(params![scope.key()], |row| {
            Ok((
                row.get::<_, PartId>(0)?,
                ThreadSummary {
                    replies: row.get::<_, i64>(1)? as usize,
                    last_reply_at: row.get(2)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(summaries)
}
