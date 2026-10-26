//! Posting a message: its parts, its files turned into sources, and the jobs they need, all
//! in one transaction.

use super::super::recordings::{live_recording_ms, move_recording_to_source};
use super::super::sources::{insert_file, queue_read};
use super::super::{Database, JobTarget, NewJob, Source, jobs::enqueue, unix_timestamp};
use super::versions::{Fresh, VERSION_COLUMNS, insert_version, version_from_row};
use super::{
    ChatMessage, MessagePart, MessageRole, MessageStatus, MessageVersion, NewPart, PartContent,
    Place, Readable, ThreadSummary, VersionOrigin, normalize_text,
};
use crate::text::truncate_chars;
use crate::{ErrorKind, Result, bail, err};
use crate::{
    JobId, JobKind, Mention, MessageId, PartId, ProjectId, SessionId, SourceOrigin, mentions,
};
use rusqlite::{Connection, OptionalExtension as _, params};

/// Most characters of a project's notes a piece of material (or a practice) reads; the latest
/// are kept.
pub(in crate::db) const MAX_NOTES_CHARS: usize = 12_000;

impl Database {
    /// Stores a complete message and its files as sources in the session's project, all in
    /// one transaction, its text as the message's first version (the parts of
    /// [`NewPart::Text`], joined by blank lines), on the timeline or in a thread (`place` takes a
    /// [`SessionId`] for the timeline). It queues a job that reads each [`Readable`] source
    /// and, while the session's title is provisional, one that names it once those are read.
    /// A user message that mentions the assistant also gets a pending answer, in the same
    /// place, and the job that writes it. The session moves to the top of its list.
    pub fn post_message(
        &self,
        place: impl Into<Place>,
        role: MessageRole,
        parts: &[NewPart],
        readable: Readable<'_>,
    ) -> Result<ChatMessage> {
        if parts.is_empty() {
            bail!(ErrorKind::InvalidInput, "a message needs at least one part");
        }
        let text = message_text(parts)?;
        let timestamp = unix_timestamp();

        let tx = self.immediate()?;
        let located = locate(&tx, place.into())?;
        let Located {
            session_id,
            thread_root,
            ..
        } = located;
        // A note written while the session is recorded is marked with how far in it came;
        // the message that posts the recording itself is not.
        let posts_recording = parts
            .iter()
            .any(|part| matches!(part, NewPart::Recording { .. }));
        let recording = match role {
            MessageRole::User if !posts_recording => live_recording_ms(&tx, session_id)?,
            MessageRole::User | MessageRole::Assistant => None,
        };
        let recording_ms = recording.map(|(_, ms)| ms);
        tx.execute(
            "INSERT INTO messages (session_id, role, thread_root, recording_ms,
                 recording_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session_id,
                role,
                thread_root,
                recording_ms.map(|ms| ms as i64),
                recording.map(|(id, _)| id),
                timestamp
            ],
        )?;
        let message_id = MessageId::new(tx.last_insert_rowid());
        let stored = insert_parts(&tx, &located, message_id, parts, readable)?;
        let version = text
            .as_deref()
            .map(|text| insert_first_version(&tx, message_id, role, text))
            .transpose()?;
        if role == MessageRole::User {
            queue_follow_ups(&tx, &located, message_id, text.as_deref(), &stored)?;
        }
        tx.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![timestamp, session_id],
        )?;
        tx.commit()?;

        let parts = stored
            .into_iter()
            .map(|part| self.posted_part(part))
            .collect::<Result<Vec<_>>>()?;
        Ok(ChatMessage {
            id: message_id,
            session_id,
            role,
            status: MessageStatus::Complete,
            reply_to: None,
            thread_root,
            created_at: timestamp,
            recording_ms,
            recorded_in: None,
            parts,
            active_version: version.as_ref().map(|version| version.id),
            versions: version.into_iter().collect(),
            citations: Vec::new(),
            reply: None,
        })
    }

    /// A part just posted as a session page shows it: its jobs loaded, and nothing read or
    /// replied to yet.
    fn posted_part(&self, part: StoredPart) -> Result<MessagePart> {
        let mut jobs = Vec::with_capacity(part.jobs.len());
        for id in part.jobs {
            jobs.extend(self.job(id)?);
        }
        Ok(MessagePart {
            id: part.id,
            content: part.content,
            jobs,
            document: None,
            thread: ThreadSummary::default(),
        })
    }
}

/// The words of `parts`, joined, or `None` when it has no text part. Only a message with
/// words has a first version.
fn message_text(parts: &[NewPart]) -> Result<Option<String>> {
    let texts: Vec<&str> = parts
        .iter()
        .filter_map(|part| match part {
            NewPart::Text(text) => Some(text.as_str()),
            NewPart::File(_) | NewPart::Recording { .. } => None,
        })
        .collect();
    if texts.is_empty() {
        return Ok(None);
    }
    Ok(Some(normalize_text(&texts.join("\n\n"))?))
}

/// Stores `text` as the first version of a message, and makes it the active one.
fn insert_first_version(
    tx: &Connection,
    message: MessageId,
    role: MessageRole,
    text: &str,
) -> Result<MessageVersion> {
    let origin = match role {
        MessageRole::User => VersionOrigin::Typed,
        MessageRole::Assistant => VersionOrigin::Answer,
    };
    let id = insert_version(
        tx,
        message,
        Fresh {
            origin,
            instruction: None,
            status: MessageStatus::Complete,
            text,
            based_on: None,
        },
    )?;
    tx.execute(
        "UPDATE messages SET active_version_id = ?2 WHERE id = ?1",
        params![message, id],
    )?;
    let version = tx.query_row(
        &format!("SELECT {VERSION_COLUMNS} FROM message_versions v WHERE v.id = ?1"),
        params![id],
        |row| version_from_row(row, 0),
    )?;
    Ok(version)
}

/// Where a message goes, resolved from its [`Place`].
#[derive(Clone, Copy)]
struct Located {
    session_id: SessionId,
    project_id: ProjectId,
    thread_root: Option<PartId>,
}

/// Resolves `place` inside the posting transaction, so a thread's attachment cannot vanish
/// before its reply is stored.
fn locate(tx: &Connection, place: Place) -> Result<Located> {
    match place {
        Place::Timeline(session_id) => {
            let project_id = tx
                .query_row(
                    "SELECT project_id FROM sessions WHERE id = ?1",
                    params![session_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| err!(ErrorKind::NotFound, "session {session_id} does not exist"))?;
            Ok(Located {
                session_id,
                project_id,
                thread_root: None,
            })
        }
        Place::Thread(root) => {
            let (session_id, project_id, on_timeline): (_, _, bool) = tx
                .query_row(
                    "SELECT m.session_id, s.project_id, m.thread_root IS NULL
                     FROM message_parts p
                     JOIN messages m ON m.id = p.message_id
                     JOIN sessions s ON s.id = m.session_id
                     WHERE p.id = ?1",
                    params![root],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?
                .ok_or_else(|| err!(ErrorKind::NotFound, "attachment {root} does not exist"))?;
            if !on_timeline {
                bail!(
                    ErrorKind::InvalidInput,
                    "only an attachment of a timeline message starts a thread"
                );
            }
            Ok(Located {
                session_id,
                project_id,
                thread_root: Some(root),
            })
        }
    }
}

/// A part just stored, with the ids of the jobs queued for it.
struct StoredPart {
    id: PartId,
    content: PartContent,
    jobs: Vec<JobId>,
}

/// Stores the files of `parts` in order under `message_id`. Files and recordings become
/// sources of the place's project, and each [`Readable`] one gets a job that reads it.
fn insert_parts(
    tx: &Connection,
    located: &Located,
    message_id: MessageId,
    parts: &[NewPart],
    readable: Readable<'_>,
) -> Result<Vec<StoredPart>> {
    let project = Some(located.project_id);
    let mut stored = Vec::new();
    for part in parts {
        let source = match part {
            NewPart::Text(_) => continue,
            NewPart::File(path) => insert_file(tx, path, project, SourceOrigin::Attachment)?,
            NewPart::Recording { id, name } => {
                move_recording_to_source(tx, *id, located.session_id, name, project)?
            }
        };
        let reading = queue_read(tx, &source, readable)?;
        let mut part = insert_source_part(tx, message_id, stored.len(), source)?;
        part.jobs.extend(reading);
        stored.push(part);
    }
    Ok(stored)
}

/// Stores a part that shows a source.
fn insert_source_part(
    tx: &Connection,
    message_id: MessageId,
    ordinal: usize,
    source: Source,
) -> Result<StoredPart> {
    tx.execute(
        "INSERT INTO message_parts (message_id, ordinal, source_id, source_name, source_kind)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            message_id,
            ordinal as i64,
            source.id,
            source.name,
            source.kind
        ],
    )?;
    Ok(StoredPart {
        id: PartId::new(tx.last_insert_rowid()),
        content: PartContent {
            source_id: Some(source.id),
            name: source.name,
            kind: source.kind,
        },
        jobs: Vec::new(),
    })
}

/// What a user's message sets off once its parts are stored: naming the session while its
/// title is provisional and an answer when it mentions the assistant, each waiting for the
/// message's files to be read.
fn queue_follow_ups(
    tx: &Connection,
    located: &Located,
    message_id: MessageId,
    text: Option<&str>,
    stored: &[StoredPart],
) -> Result<()> {
    let reads: Vec<JobId> = stored
        .iter()
        .flat_map(|part| part.jobs.iter().copied())
        .collect();
    // The title sums up the timeline; threads go deeper into one file.
    if located.thread_root.is_none() {
        queue_title_if_provisional(tx, located.session_id, &reads)?;
    }
    // Notes are only written down; the assistant answers only when asked by name.
    let asked = text.is_some_and(|text| {
        mentions(text)
            .iter()
            .any(|(_, mention)| *mention == Mention::Assistant)
    });
    if asked {
        let answer = insert_reply(tx, located, message_id)?;
        enqueue(
            tx,
            &NewJob::new(JobKind::Reply, JobTarget::Message(answer)).after(reads),
        )?;
    }
    Ok(())
}

/// While the session's title is provisional, queues the job that names it once `reads` end.
fn queue_title_if_provisional(
    tx: &Connection,
    session_id: SessionId,
    reads: &[JobId],
) -> Result<()> {
    let provisional: bool = tx.query_row(
        "SELECT title_source = 'provisional' FROM sessions WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    if provisional {
        let title = NewJob::new(JobKind::Title, JobTarget::Session(session_id))
            .after(reads.iter().copied());
        enqueue(tx, &title)?;
    }
    Ok(())
}

/// Stores an assistant message answering `asked`, beside it, with its first version waiting
/// to be written.
fn insert_reply(tx: &Connection, located: &Located, asked: MessageId) -> Result<MessageId> {
    tx.execute(
        "INSERT INTO messages (session_id, role, reply_to, thread_root, created_at)
         VALUES (?1, 'assistant', ?2, ?3, ?4)",
        params![
            located.session_id,
            asked,
            located.thread_root,
            unix_timestamp()
        ],
    )?;
    let answer = MessageId::new(tx.last_insert_rowid());
    insert_version(
        tx,
        answer,
        Fresh {
            origin: VersionOrigin::Answer,
            instruction: None,
            status: MessageStatus::Pending,
            text: "",
            based_on: None,
        },
    )?;
    Ok(answer)
}

/// The latest `notes` that fit in `budget` characters, oldest first, one per line. The
/// oldest note kept is cut to what is left of the budget, so a long one still counts.
pub(in crate::db) fn latest_notes(notes: &[String], budget: usize) -> String {
    let mut left = budget;
    let mut kept = Vec::new();
    for note in notes.iter().rev() {
        if left == 0 {
            break;
        }
        let note = truncate_chars(note, left);
        // One more for the line break that joins it to the next.
        left = left.saturating_sub(note.chars().count() + 1);
        kept.push(note);
    }
    kept.reverse();
    kept.join("\n")
}

#[cfg(test)]
mod tests {
    use super::latest_notes;

    #[test]
    fn the_latest_notes_are_kept_and_a_long_one_is_cut_not_dropped() {
        let notes = ["first".to_owned(), "second".to_owned(), "x".repeat(50)];
        assert_eq!(latest_notes(&notes[..2], 100), "first\nsecond");
        assert_eq!(latest_notes(&notes[..2], 7), "second");
        assert_eq!(latest_notes(&notes, 10), "x".repeat(10));
    }
}
