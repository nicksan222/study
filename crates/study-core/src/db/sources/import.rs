//! Transactional source insertion: file sniffing, blob writes, hashing, and read jobs.

use super::super::{JobTarget, NewJob, Readable, jobs::enqueue, unix_timestamp};
use super::blob::open_blob;
use super::{Source, check_source_size};
use crate::{Context as _, Error, ErrorKind, Result, bail, err};
use crate::{JobId, JobKind, ProjectId, SourceId, SourceKind, SourceOrigin, sniff};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest as _, Sha256};
use std::{
    fs::File,
    io::{self, Read, Seek as _, SeekFrom, Write},
    path::Path,
};

/// How much of a file's start [`sniff`] looks at.
const SNIFF_BYTES: usize = 8 * 1024;

/// Queues the job that reads `source` when it is [`Readable`], using the caller's
/// transaction.
pub(in crate::db) fn queue_read(
    connection: &Connection,
    source: &Source,
    readable: Readable<'_>,
) -> Result<Option<JobId>> {
    if !readable(source.kind, &source.mime) {
        return Ok(None);
    }
    let job = NewJob::new(JobKind::Extract, JobTarget::Source(source.id));
    Ok(Some(enqueue(connection, &job)?))
}

/// Streams the file at `path` into a new source using the caller's transaction, so a larger
/// write (such as a chat message with attachments) can include the import atomically.
pub(in crate::db) fn insert_file(
    connection: &Connection,
    path: &Path,
    project_id: Option<ProjectId>,
    origin: SourceOrigin,
) -> Result<Source> {
    let name = file_name(path)?;
    let (mut file, size) = open_upload(path)?;
    let mut head = Vec::with_capacity(SNIFF_BYTES);
    Read::by_ref(&mut file)
        .take(SNIFF_BYTES as u64)
        .read_to_end(&mut head)
        .context("cannot read the file")?;
    file.seek(SeekFrom::Start(0))
        .context("cannot read the file")?;
    let detected = sniff(&name, &head);
    let draft = NewSource {
        name,
        kind: detected.kind,
        mime: detected.mime,
        origin,
        project_id,
        size_bytes: size,
        uri: None,
    };
    insert_source(connection, draft, |blob| {
        copy_exactly(&mut file, size as u64, blob)
    })
}

/// Copies the `size` bytes `file` was measured at into `blob`, which holds exactly that
/// many. A file that grew or shrank meanwhile is refused as [`ErrorKind::InvalidInput`]: it
/// is the user's to import again, not a fault here.
fn copy_exactly(file: &mut impl Read, size: u64, blob: &mut dyn Write) -> Result<()> {
    let copied = io::copy(&mut Read::by_ref(file).take(size), blob)
        .context("cannot stream the file into the database")?;
    let grew = file.read(&mut [0]).context("cannot read the file")? != 0;
    if copied != size || grew {
        bail!(
            ErrorKind::InvalidInput,
            "the file changed while it was being imported"
        );
    }
    Ok(())
}

/// A source's metadata before its bytes are written.
pub(in crate::db) struct NewSource<'a> {
    pub name: String,
    pub kind: SourceKind,
    pub mime: &'a str,
    pub origin: SourceOrigin,
    pub project_id: Option<ProjectId>,
    pub size_bytes: i64,
    pub uri: Option<&'a str>,
}

/// Inserts a source whose bytes `write` streams into a blob of exactly `size_bytes`, hashing
/// them on the way. Uses the caller's transaction.
pub(in crate::db) fn insert_source(
    connection: &Connection,
    source: NewSource<'_>,
    write: impl FnOnce(&mut dyn Write) -> Result<()>,
) -> Result<Source> {
    let timestamp = unix_timestamp();
    // The hash is known only once the bytes are streamed; a zeroed one holds its place.
    connection.execute(
        "INSERT INTO sources (project_id, origin, kind, mime, name, size_bytes, sha256, uri,
             created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, zeroblob(32), ?7, ?8)",
        params![
            source.project_id,
            source.origin,
            source.kind,
            source.mime,
            source.name,
            source.size_bytes,
            source.uri,
            timestamp
        ],
    )?;
    let id = SourceId::new(connection.last_insert_rowid());
    let sha256 = write_blob(connection, id, source.size_bytes, write)?;
    connection.execute(
        "UPDATE sources SET sha256 = ?1 WHERE id = ?2",
        params![sha256, id],
    )?;
    let project_name = match source.project_id {
        Some(project) => connection
            .query_row(
                "SELECT name FROM projects WHERE id = ?1",
                params![project],
                |row| row.get(0),
            )
            .optional()?,
        None => None,
    };
    Ok(Source {
        id,
        name: source.name,
        kind: source.kind,
        mime: source.mime.to_owned(),
        origin: source.origin,
        project_id: source.project_id,
        project_name,
        size_bytes: source.size_bytes,
        sha256,
        uri: source.uri.map(str::to_owned),
        created_at: timestamp,
    })
}

/// Makes the bytes `write` streams, exactly `size_bytes` of them, source `id`'s blob in place
/// of any it had, and returns their SHA-256. Uses the caller's transaction.
pub(in crate::db) fn write_blob(
    connection: &Connection,
    id: SourceId,
    size_bytes: i64,
    write: impl FnOnce(&mut dyn Write) -> Result<()>,
) -> Result<[u8; 32]> {
    // Incremental blob I/O cannot grow a blob, so its full size is reserved first.
    connection.execute(
        "INSERT INTO source_blobs (source_id, bytes) VALUES (?1, zeroblob(?2))
         ON CONFLICT (source_id) DO UPDATE SET bytes = excluded.bytes",
        params![id, size_bytes],
    )?;
    let mut writer = HashingWriter {
        inner: open_blob(connection, id, false)?,
        hasher: Sha256::new(),
    };
    write(&mut writer)?;
    writer.flush().context("cannot flush the stored source")?;
    Ok(<[u8; 32]>::from(writer.hasher.finalize()))
}

/// Writes through to a blob while hashing everything written.
struct HashingWriter<W> {
    inner: W,
    hasher: Sha256,
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// The display name for an upload: its trimmed file name, lossily decoded.
fn file_name(path: &Path) -> Result<String> {
    let name = path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| err!(ErrorKind::InvalidInput, "the path has no file name"))?
        .to_string_lossy();
    let name = name.trim();
    if name.is_empty() {
        bail!(ErrorKind::InvalidInput, "the file name cannot be empty");
    }
    Ok(name.to_owned())
}

/// Opens a regular, nonempty file within the upload limit and returns its size.
fn open_upload(path: &Path) -> Result<(File, i64)> {
    // Classified, so a file deleted or unreadable since it was picked says so.
    let file = File::open(path)
        .map_err(Error::classified)
        .context("cannot open the file")?;
    let metadata = file
        .metadata()
        .map_err(Error::classified)
        .context("cannot inspect the file")?;
    if !metadata.is_file() {
        bail!(ErrorKind::InvalidInput, "the path is not a regular file");
    }
    let size = metadata.len();
    check_source_size(size, "the file")?;
    let size = i64::try_from(size).context("the file is too large")?;
    Ok((file, size))
}

#[cfg(test)]
mod tests {
    use super::copy_exactly;
    use crate::ErrorKind;
    use std::io::Cursor;

    #[test]
    fn a_file_that_changed_while_imported_is_the_users_to_import_again() {
        let mut blob = Vec::new();
        copy_exactly(&mut Cursor::new(b"cells"), 5, &mut blob).unwrap();
        assert_eq!(blob, b"cells");

        for (file, size) in [(&b"cells!"[..], 5), (&b"cell"[..], 5)] {
            let error = copy_exactly(&mut Cursor::new(file), size, &mut Vec::new()).unwrap_err();
            assert_eq!(error.kind(), ErrorKind::InvalidInput, "{file:?}");
        }
    }
}
