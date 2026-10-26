//! Microphone recordings, saved chunk by chunk while they are taken so a crash loses at most
//! the last chunk. A recording belongs to a session until it is posted there, when
//! [`NewPart::Recording`](super::NewPart::Recording) turns it into a WAV source.

use super::sources::{MAX_SOURCE_BYTES, NewSource, Source, check_source_size, insert_source};
use super::{Database, unix_timestamp};
use crate::{Context as _, ErrorKind, Result, bail, err};
use crate::{ProjectId, RecordingId, SessionId, SourceKind, SourceOrigin};
use rusqlite::{Connection, OptionalExtension as _, Row, params};

/// Every recording is stored as mono 16-bit PCM at this rate, the rate transcription uses.
pub const RECORDING_SAMPLE_RATE: u32 = 16_000;

const WAV_HEADER_BYTES: u64 = 44;

/// The most samples a recording may hold and still fit in one source: a
/// little over four and a half hours.
pub const MAX_RECORDING_SAMPLES: u64 = (MAX_SOURCE_BYTES - WAV_HEADER_BYTES) / 2;

/// A recording not yet posted: in progress, or interrupted and waiting to be resumed,
/// posted, or discarded.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Recording {
    pub id: RecordingId,
    pub session_id: SessionId,
    pub started_at: i64,
    /// When audio was last saved.
    pub updated_at: i64,
    /// Samples saved so far, at [`RECORDING_SAMPLE_RATE`].
    pub samples: u64,
}

impl Recording {
    /// Whole seconds of audio saved so far.
    pub fn seconds(&self) -> u64 {
        self.samples / u64::from(RECORDING_SAMPLE_RATE)
    }

    /// Maps a row of [`SELECT_RECORDING`]: its columns, then its byte count.
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            session_id: row.get(1)?,
            started_at: row.get(2)?,
            updated_at: row.get(3)?,
            samples: row.get::<_, i64>(4)?.max(0) as u64 / 2,
        })
    }
}

/// A recording's columns and the bytes of audio saved so far; add `WHERE`/`ORDER BY`.
const SELECT_RECORDING: &str = "SELECT r.id, r.session_id, r.started_at, r.updated_at,
        (SELECT coalesce(sum(length(c.pcm)), 0) FROM recording_chunks c
         WHERE c.recording_id = r.id)
     FROM recordings r";

impl Database {
    /// Starts an empty recording in a session. Fails when the session does not exist.
    pub fn create_recording(&self, session_id: SessionId) -> Result<Recording> {
        let timestamp = unix_timestamp();
        self.connection.execute(
            "INSERT INTO recordings (session_id, started_at, updated_at) VALUES (?1, ?2, ?2)",
            params![session_id, timestamp],
        )?;
        Ok(Recording {
            id: RecordingId::new(self.connection.last_insert_rowid()),
            session_id,
            started_at: timestamp,
            updated_at: timestamp,
            samples: 0,
        })
    }

    /// One recording, or `None` when it was posted or discarded.
    pub fn recording(&self, id: RecordingId) -> Result<Option<Recording>> {
        recording_in(&self.connection, id)
    }

    /// Every recording not yet posted, most recently saved first.
    pub fn list_recordings(&self) -> Result<Vec<Recording>> {
        let mut statement = self.connection.prepare(&format!(
            "{SELECT_RECORDING} ORDER BY r.updated_at DESC, r.id DESC"
        ))?;
        let recordings = statement
            .query_map([], Recording::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(recordings)
    }

    /// Saves the next stretch of audio at the end of a recording. Empty audio saves nothing.
    pub fn append_recording(&self, id: RecordingId, samples: &[i16]) -> Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let pcm: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let tx = self.immediate()?;
        let changed = tx.execute(
            "UPDATE recordings SET updated_at = ?1 WHERE id = ?2",
            params![unix_timestamp(), id],
        )?;
        if changed == 0 {
            bail!(ErrorKind::NotFound, "recording {id} does not exist");
        }
        tx.execute(
            "INSERT INTO recording_chunks (recording_id, ordinal, pcm)
             VALUES (?1,
                     (SELECT coalesce(max(ordinal) + 1, 0) FROM recording_chunks
                      WHERE recording_id = ?1),
                     ?2)",
            params![id, pcm],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Throws a recording and its audio away. Returns `false` when it no longer exists.
    pub fn delete_recording(&self, id: RecordingId) -> Result<bool> {
        let changed = self
            .connection
            .execute("DELETE FROM recordings WHERE id = ?1", params![id])?;
        Ok(changed != 0)
    }
}

/// How recently a recording must have saved audio to count as under way: well past the
/// one-second save interval, so a slow save does not end it.
const LIVE_RECORDING_SECONDS: i64 = 15;

/// One recording, using the caller's transaction.
fn recording_in(connection: &Connection, id: RecordingId) -> Result<Option<Recording>> {
    let recording = connection
        .query_row(
            &format!("{SELECT_RECORDING} WHERE r.id = ?1"),
            params![id],
            Recording::from_row,
        )
        .optional()?;
    Ok(recording)
}

/// The recording under way in `session` and how far into it the student is, in
/// milliseconds of audio saved; `None` when none is. Audio is saved about every second; a
/// recording left unfinished earlier, not saved to in a while, is not under way.
pub(super) fn live_recording_ms(
    connection: &Connection,
    session: SessionId,
) -> Result<Option<(RecordingId, u64)>> {
    let recording = connection
        .query_row(
            &format!(
                "{SELECT_RECORDING} WHERE r.session_id = ?1 AND r.updated_at >= ?2
                 ORDER BY r.started_at DESC, r.id DESC LIMIT 1"
            ),
            params![session, unix_timestamp() - LIVE_RECORDING_SECONDS],
            Recording::from_row,
        )
        .optional()?;
    Ok(recording.map(|recording| {
        let ms = recording.samples * 1_000 / u64::from(RECORDING_SAMPLE_RATE);
        (recording.id, ms)
    }))
}

/// Writes a session's recording into a new WAV source named `name`, then deletes the
/// recording, inside the caller's transaction.
pub(super) fn move_recording_to_source(
    connection: &Connection,
    id: RecordingId,
    session_id: SessionId,
    name: &str,
    project_id: Option<ProjectId>,
) -> Result<Source> {
    let name = name.trim();
    if name.is_empty() {
        bail!(ErrorKind::InvalidInput, "recording name cannot be empty");
    }
    let recording = recording_in(connection, id)?
        .ok_or_else(|| err!(ErrorKind::NotFound, "recording {id} does not exist"))?;
    if recording.session_id != session_id {
        bail!(
            ErrorKind::InvalidInput,
            "recording {id} belongs to another session"
        );
    }
    let data_bytes = recording.samples * 2;
    if data_bytes == 0 {
        bail!(ErrorKind::InvalidInput, "the recording is empty");
    }
    let size = WAV_HEADER_BYTES + data_bytes;
    check_source_size(size, "the recording")?;
    let draft = NewSource {
        name: name.to_owned(),
        kind: SourceKind::Audio,
        mime: "audio/wav",
        origin: SourceOrigin::Recording,
        project_id,
        size_bytes: size as i64,
        uri: None,
    };
    let source = insert_source(connection, draft, |blob| {
        blob.write_all(&wav_header(data_bytes as u32))?;
        let mut chunks = connection
            .prepare("SELECT pcm FROM recording_chunks WHERE recording_id = ?1 ORDER BY ordinal")?;
        let mut rows = chunks.query(params![id])?;
        while let Some(row) = rows.next()? {
            let pcm = row.get_ref(0)?.as_blob()?;
            blob.write_all(pcm)
                .context("cannot write the recording into the database")?;
        }
        Ok(())
    })?;
    // The notes written while it was recorded now lead into its file.
    connection.execute(
        "UPDATE messages SET recorded_in = ?1, recording_id = NULL WHERE recording_id = ?2",
        params![source.id, id],
    )?;
    connection.execute("DELETE FROM recordings WHERE id = ?1", params![id])?;
    Ok(source)
}

/// A canonical 44-byte header for `data_bytes` of mono 16-bit PCM.
fn wav_header(data_bytes: u32) -> [u8; WAV_HEADER_BYTES as usize] {
    let rate = RECORDING_SAMPLE_RATE;
    let mut header = [0; WAV_HEADER_BYTES as usize];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes()); // bytes after these 8
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    header[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    header[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    header[24..28].copy_from_slice(&rate.to_le_bytes());
    header[28..32].copy_from_slice(&(rate * 2).to_le_bytes()); // bytes per second
    header[32..34].copy_from_slice(&2u16.to_le_bytes()); // bytes per frame
    header[34..36].copy_from_slice(&16u16.to_le_bytes()); // bits per sample
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    header
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SourceId;
    use crate::db::{MessageRole, NewPart, PartContent};

    fn session() -> Result<(tempfile::TempDir, Database, SessionId)> {
        let dir = tempfile::tempdir()?;
        let db = Database::open(dir.path().join("study.sqlite3"))?;
        let project = db.create_project("Biology")?;
        let session = db.create_session(project.id, "Lecture")?;
        Ok((dir, db, session.id))
    }

    fn recording_part(id: RecordingId, name: &str) -> NewPart {
        NewPart::Recording {
            id,
            name: name.into(),
        }
    }

    fn transcription(kind: SourceKind, _: &str) -> bool {
        kind == SourceKind::Audio
    }

    #[test]
    fn saved_audio_survives_reopening_the_database() -> Result<()> {
        let (dir, db, session_id) = session()?;
        let recording = db.create_recording(session_id)?;
        db.append_recording(recording.id, &[1; 16_000])?;
        db.append_recording(recording.id, &[])?;
        db.append_recording(recording.id, &[2; 8_000])?;
        drop(db);

        // As after a crash: everything appended is still there.
        let db = Database::open(dir.path().join("study.sqlite3"))?;
        let stored = db.recording(recording.id)?.unwrap();
        assert_eq!(stored.samples, 24_000);
        assert_eq!(stored.seconds(), 1);
        assert_eq!(db.list_recordings()?, vec![stored]);
        Ok(())
    }

    #[test]
    fn posting_a_recording_stores_a_playable_wav_and_removes_the_recording() -> Result<()> {
        let (_dir, db, session_id) = session()?;
        let recording = db.create_recording(session_id)?;
        db.append_recording(recording.id, &[0x0102, -2])?;
        db.append_recording(recording.id, &[3])?;

        let posted = db.post_message(
            session_id,
            MessageRole::User,
            &[recording_part(recording.id, "lecture.wav")],
            &transcription,
        )?;
        let PartContent {
            source_id, name, ..
        } = &posted.parts[0].content;
        assert_eq!(name, "lecture.wav");
        assert_eq!(posted.parts[0].jobs.len(), 1);

        let source = db.source(source_id.unwrap())?.unwrap();
        assert_eq!(
            (source.kind, source.origin),
            (SourceKind::Audio, SourceOrigin::Recording)
        );
        let wav = db.read_source_bounded(source.id, 1024)?.unwrap();
        assert_eq!(wav.len(), 44 + 6);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into()?), 16_000);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into()?), 6);
        assert_eq!(&wav[44..], [0x02, 0x01, 0xfe, 0xff, 0x03, 0x00]);
        assert!(db.recording(recording.id)?.is_none());
        Ok(())
    }

    /// The file a posted recording part holds.
    fn posted_file(db: &Database, session_id: SessionId, id: RecordingId) -> Result<SourceId> {
        let posted = db.post_message(
            session_id,
            MessageRole::User,
            &[recording_part(id, "lecture.wav")],
            &transcription,
        )?;
        let file = posted.parts[0].content.source_id.expect("the file");
        Ok(file)
    }

    #[test]
    fn posting_an_interrupted_recording_takes_only_the_notes_taken_in_it() -> Result<()> {
        let (_dir, db, session_id) = session()?;
        let note = |text: &str| {
            db.post_message(
                session_id,
                MessageRole::User,
                &[NewPart::Text(text.into())],
                &transcription,
            )
        };
        let first = db.create_recording(session_id)?;
        db.append_recording(first.id, &[1; 16_000])?;
        let in_first = note("in the first")?;
        // The first is interrupted: nothing saved to it for a while.
        db.connection.execute(
            "UPDATE recordings SET updated_at = updated_at - 60 WHERE id = ?1",
            params![first.id],
        )?;
        let second = db.create_recording(session_id)?;
        db.append_recording(second.id, &[1; 32_000])?;
        let in_second = note("in the second")?;
        assert_eq!(
            (in_first.recording_ms, in_second.recording_ms),
            (Some(1_000), Some(2_000))
        );

        let first_file = posted_file(&db, session_id, first.id)?;
        assert_eq!(
            db.message(in_first.id)?.unwrap().recorded_in,
            Some(first_file)
        );
        assert_eq!(db.message(in_second.id)?.unwrap().recorded_in, None);

        let second_file = posted_file(&db, session_id, second.id)?;
        assert_eq!(
            db.message(in_first.id)?.unwrap().recorded_in,
            Some(first_file)
        );
        assert_eq!(
            db.message(in_second.id)?.unwrap().recorded_in,
            Some(second_file)
        );
        Ok(())
    }

    #[test]
    fn a_recording_needs_its_session() -> Result<()> {
        let (_dir, db, session_id) = session()?;
        let gone = SessionId::new(session_id.get() + 100);
        assert_eq!(
            db.create_recording(gone).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        Ok(())
    }

    #[test]
    fn empty_foreign_or_missing_recordings_are_not_posted() -> Result<()> {
        let (_dir, db, session_id) = session()?;
        let other = db.create_session(db.list_projects()?[0].id, "Other")?;
        let empty = db.create_recording(session_id)?;
        let foreign = db.create_recording(other.id)?;
        db.append_recording(foreign.id, &[1])?;
        for (id, kind) in [
            (empty.id, ErrorKind::InvalidInput),
            (foreign.id, ErrorKind::InvalidInput),
            (RecordingId::new(999), ErrorKind::NotFound),
        ] {
            let part = recording_part(id, "lecture.wav");
            let error = db
                .post_message(session_id, MessageRole::User, &[part], &transcription)
                .unwrap_err();
            assert_eq!(error.kind(), kind, "{id}");
        }
        assert!(db.list_messages(session_id)?.is_empty());
        assert!(db.list_sources()?.is_empty());
        assert_eq!(db.list_recordings()?.len(), 2);
        Ok(())
    }

    #[test]
    fn recordings_go_with_their_session_or_when_discarded() -> Result<()> {
        let (_dir, db, session_id) = session()?;
        let kept = db.create_recording(session_id)?;
        let discarded = db.create_recording(session_id)?;
        db.append_recording(discarded.id, &[1, 2, 3])?;
        assert!(db.delete_recording(discarded.id)?);
        assert!(!db.delete_recording(discarded.id)?);
        let error = db.append_recording(discarded.id, &[1]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::NotFound);
        assert_eq!(db.list_recordings()?, vec![kept]);

        db.delete_session(session_id)?;
        assert!(db.list_recordings()?.is_empty());
        let chunks: i64 =
            db.connection
                .query_row("SELECT count(*) FROM recording_chunks", [], |row| {
                    row.get(0)
                })?;
        assert_eq!(chunks, 0);
        Ok(())
    }
}
