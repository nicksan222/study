//! Sources: everything the user brought in. Bytes are streamed into `source_blobs` so large
//! files never sit in memory; kind, media type and SHA-256 are worked out on the way in. A
//! link holds only its address until its Fetch job stores what the address holds in its
//! place.
//! Queries and public import operations live here; `import` owns transactional writes and
//! `blob` owns bounded reads and streaming access.

mod blob;
mod import;
#[cfg(test)]
mod tests;

pub(super) use import::{NewSource, insert_file, insert_source, queue_read};

use super::jobs::enqueue;
use super::{Database, JobTarget, NewJob, Readable};
use crate::processing::Fetched;
use crate::{Context as _, ErrorKind, Result, bail, mime};
use crate::{JobId, JobKind, ProjectId, SourceId, SourceKind, SourceOrigin};
use import::write_blob;
use rusqlite::{OptionalExtension, Row, params};
use std::path::Path;

/// The largest source Study stores, in bytes: imports, attachments and recordings above it
/// are refused, and the schema checks it too.
pub const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;

/// Refuses, as [`ErrorKind::InvalidInput`], a source of `size` bytes that is empty or over
/// [`MAX_SOURCE_BYTES`]; `what` names it in the error, such as `the file`.
pub(super) fn check_source_size(size: u64, what: &str) -> Result<()> {
    if size == 0 {
        bail!(ErrorKind::InvalidInput, "{what} is empty");
    }
    if size > MAX_SOURCE_BYTES {
        bail!(
            ErrorKind::InvalidInput,
            "{what} exceeds the {} MiB limit",
            MAX_SOURCE_BYTES >> 20
        );
    }
    Ok(())
}

/// A stored source, with the name of its project.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Source {
    pub id: SourceId,
    pub name: String,
    pub kind: SourceKind,
    pub mime: String,
    pub origin: SourceOrigin,
    pub project_id: Option<ProjectId>,
    pub project_name: Option<String>,
    pub size_bytes: i64,
    pub sha256: [u8; 32],
    /// Where a web page or video came from.
    pub uri: Option<String>,
    pub created_at: i64,
}

/// Bytes made or fetched inside Study, such as a typed note or a web page, to store as a
/// source.
#[derive(Clone, Copy, Debug)]
pub struct NewBytes<'a> {
    pub name: &'a str,
    pub bytes: &'a [u8],
    pub kind: SourceKind,
    pub mime: &'a str,
    pub origin: SourceOrigin,
    pub project_id: Option<ProjectId>,
    /// Where it came from on the web.
    pub uri: Option<&'a str>,
}

/// The columns [`Source::from_row`] maps, and the join they need; add `WHERE`/`ORDER BY`.
const SELECT_SOURCE: &str = "SELECT sources.id, sources.name, sources.kind, sources.mime,
        sources.origin, sources.project_id, projects.name, sources.size_bytes, sources.sha256,
        sources.created_at, sources.uri
    FROM sources
    LEFT JOIN projects ON projects.id = sources.project_id";

impl Source {
    /// Map a row of [`SELECT_SOURCE`].
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            mime: row.get(3)?,
            origin: row.get(4)?,
            project_id: row.get(5)?,
            project_name: row.get(6)?,
            size_bytes: row.get(7)?,
            sha256: row.get(8)?,
            created_at: row.get(9)?,
            uri: row.get(10)?,
        })
    }
}

impl Database {
    /// Every source with its project name, newest first.
    pub fn list_sources(&self) -> Result<Vec<Source>> {
        let mut statement = self
            .connection
            .prepare(&format!("{SELECT_SOURCE} ORDER BY sources.id DESC"))?;
        let sources = statement
            .query_map([], Source::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(sources)
    }

    /// One source, or `None` when no source has this `id`.
    pub fn source(&self, id: SourceId) -> Result<Option<Source>> {
        let source = self
            .connection
            .query_row(
                &format!("{SELECT_SOURCE} WHERE sources.id = ?1"),
                params![id],
                Source::from_row,
            )
            .optional()?;
        Ok(source)
    }

    /// Streams a local file into the Library, optionally inside a project, without reading
    /// it; for tests. Nothing is stored unless the whole file is copied.
    #[cfg(any(test, feature = "seed"))]
    pub fn import_source(&self, path: &Path, project_id: Option<ProjectId>) -> Result<Source> {
        let tx = self.immediate()?;
        let source = insert_file(&tx, path, project_id, SourceOrigin::Import)?;
        tx.commit()?;
        Ok(source)
    }

    /// Stores bytes made or fetched in Study as a source and, when they are [`Readable`],
    /// queues the job that reads them, in one transaction. Returns the job too.
    pub fn store_source(
        &self,
        new: NewBytes<'_>,
        readable: Readable<'_>,
    ) -> Result<(Source, Option<JobId>)> {
        let name = new.name.trim();
        if name.is_empty() {
            bail!(ErrorKind::InvalidInput, "a source needs a name");
        }
        check_source_size(new.bytes.len() as u64, "the source")?;
        let tx = self.immediate()?;
        let draft = NewSource {
            name: name.to_owned(),
            kind: new.kind,
            mime: new.mime,
            origin: new.origin,
            project_id: new.project_id,
            size_bytes: new.bytes.len() as i64,
            uri: new.uri,
        };
        let source = insert_source(&tx, draft, |blob| {
            blob.write_all(new.bytes)
                .context("cannot write the source into the database")?;
            Ok(())
        })?;
        let job = queue_read(&tx, &source, readable)?;
        tx.commit()?;
        Ok((source, job))
    }

    /// Streams a local file into the Library, optionally inside a project, and, when it is
    /// [`Readable`], queues the job that reads it in the same transaction, so the source is
    /// never stored without it. Nothing is stored unless the whole file is copied. Returns
    /// the job too.
    pub fn import_source_to_read(
        &self,
        path: &Path,
        project_id: Option<ProjectId>,
        readable: Readable<'_>,
    ) -> Result<(Source, Option<JobId>)> {
        let tx = self.immediate()?;
        let source = insert_file(&tx, path, project_id, SourceOrigin::Import)?;
        let job = queue_read(&tx, &source, readable)?;
        tx.commit()?;
        Ok((source, job))
    }

    /// Stores the web address `url`, trimmed, as a [`SourceKind::Link`] source, optionally
    /// inside a project, and queues the Fetch job that brings in what it holds, in one
    /// transaction. Until then the source holds the address itself, as a URI list. Returns
    /// the job too.
    pub fn add_link(&self, project_id: Option<ProjectId>, url: &str) -> Result<(Source, JobId)> {
        let url = url.trim();
        check_source_size(url.len() as u64, "the link")?;
        let tx = self.immediate()?;
        let draft = NewSource {
            name: url.to_owned(),
            kind: SourceKind::Link,
            mime: mime::URI_LIST,
            origin: SourceOrigin::Web,
            project_id,
            size_bytes: url.len() as i64,
            uri: Some(url),
        };
        let source = insert_source(&tx, draft, |blob| {
            blob.write_all(url.as_bytes())
                .context("cannot write the link into the database")?;
            Ok(())
        })?;
        let fetch = NewJob::new(JobKind::Fetch, JobTarget::Source(source.id));
        let job = enqueue(&tx, &fetch)?;
        tx.commit()?;
        Ok((source, job))
    }

    /// Replaces link source `id` with what its Fetch job brought in, keeping its id: its
    /// bytes, kind, media type, name and address, in one transaction. `None` when the source
    /// is gone; refused as [`ErrorKind::InvalidInput`] when the fetch is empty, too large or
    /// has a blank name, or the source is no longer a link.
    pub fn store_fetched(&self, id: SourceId, fetched: &Fetched) -> Result<Option<Source>> {
        let name = fetched.name.trim();
        if name.is_empty() {
            bail!(ErrorKind::InvalidInput, "a source needs a name");
        }
        check_source_size(fetched.bytes.len() as u64, "what the link holds")?;
        let size_bytes = fetched.bytes.len() as i64;
        let tx = self.immediate()?;
        let kind: Option<SourceKind> = tx
            .query_row(
                "SELECT kind FROM sources WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        match kind {
            None => return Ok(None),
            Some(SourceKind::Link) => {}
            Some(kind) => bail!(
                ErrorKind::InvalidInput,
                "the source is a {kind}, not a link"
            ),
        }
        let sha256 = write_blob(&tx, id, size_bytes, |blob| {
            blob.write_all(&fetched.bytes)
                .context("cannot write what the link holds into the database")?;
            Ok(())
        })?;
        tx.execute(
            "UPDATE sources SET kind = ?2, mime = ?3, name = ?4, size_bytes = ?5, sha256 = ?6,
                 uri = ?7
             WHERE id = ?1",
            params![
                id,
                fetched.kind,
                fetched.mime,
                name,
                size_bytes,
                sha256,
                fetched.uri
            ],
        )?;
        tx.commit()?;
        self.source(id)
    }

    /// Sources that have no document and whose every read succeeded: files stored while
    /// background work was off, and ones whose read was skipped because reading was switched
    /// off (that job succeeded without a document). A read in any other state keeps its
    /// source out: one waiting or running will finish, and one failed or cancelled waits for
    /// the user to retry it.
    pub fn unread_sources(&self) -> Result<Vec<Source>> {
        let mut statement = self.connection.prepare(&format!(
            "{SELECT_SOURCE}
             WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.source_id = sources.id)
               AND NOT EXISTS (SELECT 1 FROM jobs j
                               WHERE j.source_id = sources.id AND j.kind = '{}'
                                 AND j.status != 'succeeded')
             ORDER BY sources.id",
            JobKind::Extract
        ))?;
        let sources = statement
            .query_map([], Source::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(sources)
    }

    /// Moves a source into a project, or out of any project with `None`.
    /// Returns `false` when no source has this `id`.
    pub fn set_source_project(&self, id: SourceId, project_id: Option<ProjectId>) -> Result<bool> {
        let changed = self.connection.execute(
            "UPDATE sources SET project_id = ?1 WHERE id = ?2",
            params![project_id, id],
        )?;
        Ok(changed != 0)
    }

    /// Returns `false` when no source has this `id`.
    pub fn delete_source(&self, id: SourceId) -> Result<bool> {
        let changed = self
            .connection
            .execute("DELETE FROM sources WHERE id = ?1", params![id])?;
        Ok(changed != 0)
    }
}
