//! Versions: what a message says, as a numbered list of texts kept side by side. The
//! student's own words are the first; each edit, each answer written again and each rewrite
//! adds one, and one is active: the one shown and the one every other feature reads.
//!
//! Versions written by a model (an answer, a rewrite) are stored first as unfinished
//! versions with the job that writes them, in one transaction, so a message never holds a
//! job without its version. A message has at most one unfinished version, and it counts as
//! busy while its job has not ended. A job that failed leaves its version, so retrying the
//! job reuses it; asking for anything else first drops it. A written version becomes active
//! only if the version it revises still is: the student may have gone back to another one, or
//! edited, while the model wrote.

use super::super::citations::{CitedBy, citations_of, replace_citations};
use super::super::jobs::{JobTarget, NewJob, PENDING, enqueue, pending_reads_of};
use super::super::{Database, unix_timestamp};
use super::{MessageRole, MessageStatus, normalize_text};
use crate::{Citation, JobId, JobKind, MessageId, Result, SourceId, VersionId};
use rusqlite::{Connection, OptionalExtension as _, params};

crate::text_enum! {
    /// How a version came to be.
    pub enum VersionOrigin {
        /// What the student first wrote.
        Typed = "typed",
        /// What the student changed it to.
        Edited = "edited",
        /// The assistant's answer.
        Answer = "answer",
        /// A rewrite that improves the text.
        Improve = "improve",
        /// A rewrite that shortens the text.
        Summarize = "summarize",
        /// A rewrite as the student asked, in [`MessageVersion::instruction`].
        Instruction = "instruction",
    }
}

/// How to rewrite a message.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Rewrite {
    Improve,
    Summarize,
    /// What the student asked for, in their words.
    Instruction(String),
}

impl Rewrite {
    fn origin(&self) -> VersionOrigin {
        match self {
            Self::Improve => VersionOrigin::Improve,
            Self::Summarize => VersionOrigin::Summarize,
            Self::Instruction(_) => VersionOrigin::Instruction,
        }
    }
}

/// One version of a message's text.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessageVersion {
    pub id: VersionId,
    /// Its place in the message's list, from 1, in the order the versions were made.
    pub number: u32,
    pub origin: VersionOrigin,
    /// What the student asked for, when `origin` is [`VersionOrigin::Instruction`].
    pub instruction: Option<String>,
    /// [`Complete`](MessageStatus::Complete) once written; until then `text` is empty.
    pub status: MessageStatus,
    /// Markdown; model-written versions cite their passages as `[n]`.
    pub text: String,
    /// The version this one revises, when a model wrote it.
    pub based_on: Option<VersionId>,
    pub created_at: i64,
}

/// Maps [`VERSION_COLUMNS`] starting at `offset`.
pub(super) fn version_from_row(
    row: &rusqlite::Row,
    offset: usize,
) -> rusqlite::Result<MessageVersion> {
    Ok(MessageVersion {
        id: row.get(offset)?,
        number: row.get(offset + 1)?,
        origin: row.get(offset + 2)?,
        instruction: row.get(offset + 3)?,
        status: row.get(offset + 4)?,
        text: row.get(offset + 5)?,
        based_on: row.get(offset + 6)?,
        created_at: row.get(offset + 7)?,
    })
}

/// The columns [`version_from_row`] maps.
pub(super) const VERSION_COLUMNS: &str =
    "v.id, v.number, v.origin, v.instruction, v.status, v.text, v.based_on, v.created_at";

/// What asking for a new version came to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Asked {
    /// The version is stored and this job writes it.
    Queued(JobId),
    /// Another version of the message is still being written.
    Busy,
    /// The message does not exist, or has no finished text to start from, or is not the
    /// kind of message the request is for.
    Unavailable,
}

/// A version a job is about to write, as that job reads it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingVersion {
    pub id: VersionId,
    pub origin: VersionOrigin,
    pub instruction: Option<String>,
    /// The text of the version it revises; empty for a first answer.
    pub source_text: String,
    /// The passages the version it revises cites, in marker order; empty when it cites none.
    pub citations: Vec<Citation>,
}

impl Database {
    /// Writes `text` as the message's new active version, as the student's edit. Returns
    /// `None`, and changes nothing, when the message does not exist or the text is empty or
    /// equal to the active one. A version still being written is dropped with its job, so
    /// that it cannot replace the edit.
    pub fn edit_message(&self, id: MessageId, text: &str) -> Result<Option<VersionId>> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }
        let text = normalize_text(text)?;
        let tx = self.immediate()?;
        let Some(active) = active_of(&tx, id)? else {
            return Ok(None);
        };
        let current = match active {
            Some(version) => Some(text_of(&tx, version)?),
            None => None,
        };
        if current.as_deref() == Some(text.as_str()) {
            return Ok(None);
        }
        drop_unfinished(&tx, id)?;
        let origin = match active {
            Some(_) => VersionOrigin::Edited,
            None => VersionOrigin::Typed,
        };
        let version = insert_version(
            &tx,
            id,
            Fresh {
                origin,
                instruction: None,
                status: MessageStatus::Complete,
                text: &text,
                based_on: active,
            },
        )?;
        tx.execute(
            "UPDATE messages SET active_version_id = ?2 WHERE id = ?1",
            params![id, version],
        )?;
        tx.commit()?;
        Ok(Some(version))
    }

    /// Asks for a finished answer to be written again: a new answer version and the reply
    /// job that writes it, while the current one stays active until it is done.
    pub fn reanswer(&self, id: MessageId) -> Result<Asked> {
        self.ask(
            id,
            JobKind::Reply,
            VersionOrigin::Answer,
            None,
            Some(MessageRole::Assistant),
        )
    }

    /// Asks for the message to be rewritten from its active version: a new version and the
    /// rewrite job that writes it. The instruction of [`Rewrite::Instruction`] cannot be empty.
    pub fn rewrite_message(&self, id: MessageId, how: &Rewrite) -> Result<Asked> {
        let instruction = match how {
            Rewrite::Instruction(text) => Some(normalize_text(text)?),
            Rewrite::Improve | Rewrite::Summarize => None,
        };
        self.ask(
            id,
            JobKind::Rewrite,
            how.origin(),
            instruction.as_deref(),
            None,
        )
    }

    /// Stores a new unfinished version, based on the active one, and queues its `job`.
    /// Only a message of role `only`, when given, can be asked.
    fn ask(
        &self,
        id: MessageId,
        job: JobKind,
        origin: VersionOrigin,
        instruction: Option<&str>,
        only: Option<MessageRole>,
    ) -> Result<Asked> {
        let tx = self.immediate()?;
        let active: Option<Option<VersionId>> = tx
            .query_row(
                "SELECT active_version_id FROM messages
                 WHERE id = ?1 AND (?2 IS NULL OR role = ?2)",
                params![id, only],
                |row| row.get(0),
            )
            .optional()?;
        let Some(Some(active)) = active else {
            return Ok(Asked::Unavailable);
        };
        if is_busy(&tx, id)? {
            return Ok(Asked::Busy);
        }
        drop_unfinished(&tx, id)?;
        insert_version(
            &tx,
            id,
            Fresh {
                origin,
                instruction,
                status: MessageStatus::Pending,
                text: "",
                based_on: Some(active),
            },
        )?;
        // The text read from the message's files is what the job cites: wait for it.
        let sources: Vec<SourceId> = tx
            .prepare("SELECT source_id FROM message_parts WHERE message_id = ?1 AND source_id IS NOT NULL")?
            .query_map(params![id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let reads = pending_reads_of(&tx, &sources)?;
        let queued = enqueue(&tx, &NewJob::new(job, JobTarget::Message(id)).after(reads))?;
        tx.commit()?;
        Ok(Asked::Queued(queued))
    }

    /// Makes `version` the one the message shows and everything reads. `false` when it is not
    /// a finished version of that message.
    pub fn set_active_version(&self, message: MessageId, version: VersionId) -> Result<bool> {
        let changed = self.connection.execute(
            "UPDATE messages SET active_version_id = ?2
             WHERE id = ?1 AND EXISTS (
                 SELECT 1 FROM message_versions
                 WHERE id = ?2 AND message_id = ?1 AND status = 'complete')",
            params![message, version],
        )?;
        Ok(changed != 0)
    }

    /// Marks the version being written for `message` as writing, and returns what the job of
    /// `kind` needs. `None` when there is nothing for that job to write: the version was
    /// dropped, or it is one another kind of job writes, which is then left as it was.
    pub fn begin_version(
        &self,
        message: MessageId,
        kind: JobKind,
    ) -> Result<Option<PendingVersion>> {
        let tx = self.immediate()?;
        let origins = written_by(kind)
            .iter()
            .map(|origin| format!("'{origin}'"))
            .collect::<Vec<_>>()
            .join(", ");
        let pending = tx
            .query_row(
                &format!(
                    "SELECT v.id, v.origin, v.instruction,
                            coalesce((SELECT b.text FROM message_versions b WHERE b.id = v.based_on), ''),
                            v.based_on
                     FROM message_versions v
                     WHERE v.message_id = ?1 AND v.status != 'complete' AND v.origin IN ({origins})"
                ),
                params![message],
                |row| {
                    Ok((
                        PendingVersion {
                            id: row.get(0)?,
                            origin: row.get(1)?,
                            instruction: row.get(2)?,
                            source_text: row.get(3)?,
                            citations: Vec::new(),
                        },
                        row.get::<_, Option<VersionId>>(4)?,
                    ))
                },
            )
            .optional()?;
        let pending = match pending {
            Some((mut pending, based_on)) => {
                if let Some(based_on) = based_on {
                    pending.citations = citations_of(&tx, CitedBy::Version(based_on))?;
                }
                Some(pending)
            }
            None => None,
        };
        if let Some(pending) = &pending {
            tx.execute(
                "UPDATE message_versions SET status = 'writing' WHERE id = ?1",
                params![pending.id],
            )?;
        }
        tx.commit()?;
        Ok(pending)
    }

    /// Stores what a model wrote for an unfinished version, with the passages it cites, and
    /// marks it complete. It becomes the active version only if the version it revises still
    /// is. Returns `false` when the version is gone or already complete.
    pub fn finish_version(
        &self,
        version: VersionId,
        text: &str,
        citations: &[Citation],
    ) -> Result<bool> {
        let text = normalize_text(text)?;
        let tx = self.immediate()?;
        let unfinished: Option<(MessageId, Option<VersionId>)> = tx
            .query_row(
                "SELECT message_id, based_on FROM message_versions
                 WHERE id = ?1 AND status != 'complete'",
                params![version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((message, based_on)) = unfinished else {
            return Ok(false);
        };
        tx.execute(
            "UPDATE message_versions SET status = 'complete', text = ?2 WHERE id = ?1",
            params![version, text],
        )?;
        replace_citations(&tx, CitedBy::Version(version), citations)?;
        tx.execute(
            "UPDATE messages SET active_version_id = ?2
             WHERE id = ?1 AND active_version_id IS ?3",
            params![message, version, based_on],
        )?;
        tx.commit()?;
        Ok(true)
    }
}

/// The active version of `message` (itself `None` when it has none), or `None` when the
/// message does not exist.
fn active_of(tx: &Connection, message: MessageId) -> Result<Option<Option<VersionId>>> {
    Ok(tx
        .query_row(
            "SELECT active_version_id FROM messages WHERE id = ?1",
            params![message],
            |row| row.get(0),
        )
        .optional()?)
}

fn text_of(tx: &Connection, version: VersionId) -> Result<String> {
    Ok(tx.query_row(
        "SELECT text FROM message_versions WHERE id = ?1",
        params![version],
        |row| row.get(0),
    )?)
}

/// The origins of the versions a job of `kind` writes.
fn written_by(kind: JobKind) -> &'static [VersionOrigin] {
    match kind {
        JobKind::Reply => &[VersionOrigin::Answer],
        JobKind::Rewrite => &[
            VersionOrigin::Improve,
            VersionOrigin::Summarize,
            VersionOrigin::Instruction,
        ],
        _ => &[],
    }
}

/// Whether a job writing a version of `message` has not ended.
fn is_busy(tx: &Connection, message: MessageId) -> Result<bool> {
    Ok(tx.query_row(
        &format!(
            "SELECT EXISTS (SELECT 1 FROM jobs
                 WHERE message_id = ?1 AND kind IN ('{}', '{}') AND status IN {PENDING})",
            JobKind::Reply,
            JobKind::Rewrite
        ),
        params![message],
        |row| row.get(0),
    )?)
}

/// Drops the unfinished version of `message`, if any, and the jobs that wrote or would write
/// it. One that is running is deleted too, so that its worker can be stopped.
fn drop_unfinished(tx: &Connection, message: MessageId) -> Result<()> {
    tx.execute(
        "DELETE FROM message_versions WHERE message_id = ?1 AND status != 'complete'",
        params![message],
    )?;
    tx.execute(
        &format!(
            "DELETE FROM jobs WHERE message_id = ?1 AND kind IN ('{}', '{}')",
            JobKind::Reply,
            JobKind::Rewrite
        ),
        params![message],
    )?;
    Ok(())
}

/// A version to store.
pub(super) struct Fresh<'a> {
    pub origin: VersionOrigin,
    pub instruction: Option<&'a str>,
    pub status: MessageStatus,
    pub text: &'a str,
    pub based_on: Option<VersionId>,
}

/// Stores `version` as the last of `message`'s list.
pub(super) fn insert_version(
    tx: &Connection,
    message: MessageId,
    version: Fresh<'_>,
) -> Result<VersionId> {
    tx.execute(
        "INSERT INTO message_versions
             (message_id, number, origin, instruction, status, text, based_on, created_at)
         VALUES (?1,
                 (SELECT coalesce(max(number), 0) + 1 FROM message_versions WHERE message_id = ?1),
                 ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            message,
            version.origin,
            version.instruction,
            version.status,
            version.text,
            version.based_on,
            unix_timestamp()
        ],
    )?;
    Ok(VersionId::new(tx.last_insert_rowid()))
}
