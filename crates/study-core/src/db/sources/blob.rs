//! Streaming reads and bounded access to stored source bytes.

use super::super::Database;
use crate::{Context as _, ErrorKind, Result, SourceId, bail, err};
use rusqlite::{Connection, DatabaseName, OptionalExtension, blob::Blob, params};
use std::io::{self, Read, Write};

impl Database {
    /// Streams a source's bytes without first allocating the whole file.
    ///
    /// Returns the number of bytes written and fails when `id` does not exist.
    pub fn export_source(&self, id: SourceId, mut destination: impl Write) -> Result<u64> {
        let expected_size = self.source_size(id)?;
        let mut blob = open_blob(&self.connection, id, true)?;
        let copied =
            io::copy(&mut blob, &mut destination).context("cannot export stored source")?;
        if copied != expected_size {
            bail!("stored source size does not match its metadata");
        }
        Ok(copied)
    }

    /// Reads a source's bytes only when they fit within `max_bytes`.
    ///
    /// `Ok(None)` means the source exists but is larger than the requested bound.
    pub fn read_source_bounded(&self, id: SourceId, max_bytes: usize) -> Result<Option<Vec<u8>>> {
        let size = self.source_size(id)?;
        if size > max_bytes as u64 {
            return Ok(None);
        }
        let mut bytes = Vec::with_capacity(size as usize);
        self.export_source(id, &mut bytes)?;
        Ok(Some(bytes))
    }

    /// Reads at most the first `max_bytes` of a source, for bounded text previews.
    pub fn read_source_prefix(&self, id: SourceId, max_bytes: usize) -> Result<Vec<u8>> {
        let size = self.source_size(id)?;
        let capacity = usize::try_from(size.min(max_bytes as u64)).unwrap_or(max_bytes);
        let mut blob = open_blob(&self.connection, id, true)?;
        let mut bytes = Vec::with_capacity(capacity);
        Read::by_ref(&mut blob)
            .take(max_bytes as u64)
            .read_to_end(&mut bytes)
            .context("cannot read stored source")?;
        Ok(bytes)
    }

    /// Stored size; fails when `id` does not exist.
    fn source_size(&self, id: SourceId) -> Result<u64> {
        let size = self
            .connection
            .query_row(
                "SELECT size_bytes FROM sources WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| err!(ErrorKind::NotFound, "source {id} does not exist"))?;
        u64::try_from(size).context("stored source size is invalid")
    }
}

/// Opens a source's bytes for streaming.
pub(super) fn open_blob(
    connection: &Connection,
    id: SourceId,
    read_only: bool,
) -> Result<Blob<'_>> {
    connection
        .blob_open(
            DatabaseName::Main,
            "source_blobs",
            "bytes",
            id.get(),
            read_only,
        )
        .context("cannot open the stored source")
}
