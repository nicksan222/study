//! Importing, reading, exporting and deleting sources, and the size limit.

use super::{MAX_SOURCE_BYTES, check_source_size};
use crate::db::{Database, JobTarget};
use crate::processing::Fetched;
use crate::{ErrorKind, JobKind, JobStatus, Result, mime};
use crate::{ProjectId, SourceId, SourceKind, SourceOrigin};
use rusqlite::params;
use sha2::{Digest as _, Sha256};
use std::fs;

#[test]
fn source_import_streams_bytes_and_reads_them_back() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let database = dir.path().join("study.sqlite3");
    let file = dir.path().join("notes.bin");
    let bytes = b"streamed study material";
    fs::write(&file, bytes)?;
    let db = Database::open(&database)?;
    let project = db.create_project("Physics")?;
    let item = db.import_source(&file, Some(project.id))?;
    assert_eq!(item.name, "notes.bin");
    assert_eq!(item.size_bytes, bytes.len() as i64);
    assert_eq!(item.project_name.as_deref(), Some("Physics"));
    assert_eq!(item.origin, SourceOrigin::Import);
    assert_eq!(
        (item.kind, item.mime.as_str()),
        (SourceKind::Text, "text/plain")
    );
    assert_eq!(item.sha256, <[u8; 32]>::from(Sha256::digest(bytes)));
    assert_eq!(db.source(item.id)?, Some(item.clone()));

    assert_eq!(
        db.read_source_bounded(item.id, 1024)?.as_deref(),
        Some(&bytes[..])
    );
    Ok(())
}

#[test]
fn source_read_and_export_apis_are_bounded_and_exact() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let file = dir.path().join("notes.txt");
    let bytes = b"abcdefghij";
    fs::write(&file, bytes)?;
    let item = db.import_source(&file, None)?;

    assert_eq!(db.read_source_prefix(item.id, 4)?, b"abcd");
    assert_eq!(
        db.read_source_bounded(item.id, bytes.len())?,
        Some(bytes.to_vec())
    );
    assert_eq!(db.read_source_bounded(item.id, bytes.len() - 1)?, None);

    let mut exported = Vec::new();
    assert_eq!(
        db.export_source(item.id, &mut exported)?,
        bytes.len() as u64
    );
    assert_eq!(exported, bytes);
    let missing = SourceId::new(999);
    let error = db.export_source(missing, Vec::new()).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::NotFound);
    assert!(db.read_source_prefix(missing, 4).is_err());
    Ok(())
}

#[test]
fn content_decides_the_kind_over_the_name() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let file = dir.path().join("scan.txt");
    fs::write(&file, b"%PDF-1.7\n")?;
    let item = db.import_source(&file, None)?;
    assert_eq!(
        (item.kind, item.mime.as_str()),
        (SourceKind::Pdf, "application/pdf")
    );
    Ok(())
}

#[test]
fn source_project_associations_can_change_and_detach_on_delete() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let file = dir.path().join("lesson.txt");
    fs::write(&file, b"lesson")?;
    let first = db.create_project("First")?;
    let second = db.create_project("Second")?;
    let item = db.import_source(&file, Some(first.id))?;
    assert!(db.set_source_project(item.id, Some(second.id))?);
    assert_eq!(
        db.list_sources()?[0].project_name.as_deref(),
        Some("Second")
    );
    let gone = ProjectId::new(second.id.get() + 100);
    let error = db.set_source_project(item.id, Some(gone)).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::NotFound);
    let error = db.import_source(&file, Some(gone)).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::NotFound);
    assert!(db.delete_project(second.id)?);
    let detached = db.list_sources()?;
    assert_eq!(detached[0].project_id, None);
    assert_eq!(detached[0].project_name, None);
    Ok(())
}

#[test]
fn failed_imports_are_rejected_atomically() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let empty = dir.path().join("empty.bin");
    fs::write(&empty, [])?;
    for path in [empty.as_path(), dir.path()] {
        let error = db.import_source(path, None).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput, "{path:?}");
    }
    let gone = db
        .import_source(&dir.path().join("gone.bin"), None)
        .unwrap_err();
    assert_eq!(gone.kind(), ErrorKind::NotFound);
    let missing_project = dir.path().join("missing-project.bin");
    fs::write(&missing_project, b"bytes")?;
    assert!(
        db.import_source(&missing_project, Some(ProjectId::new(999)))
            .is_err()
    );
    assert!(db.list_sources()?.is_empty());
    Ok(())
}

#[test]
fn the_schema_rejects_invalid_sources() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let insert = |kind: &str, size: i64, sha: &[u8]| {
        db.connection.execute(
            "INSERT INTO sources (origin, kind, mime, name, size_bytes, sha256, created_at)
                 VALUES ('import', ?1, 'text/plain', 'invalid', ?2, ?3, 1)",
            params![kind, size, sha],
        )
    };
    assert!(insert("text", 536_870_913, &[0; 32]).is_err());
    assert!(insert("text", 1, &[0; 31]).is_err());
    assert!(insert("media", 1, &[0; 32]).is_err());
    assert!(db.list_sources()?.is_empty());
    Ok(())
}

#[cfg(unix)]
#[test]
fn imports_accept_non_utf8_file_names() -> Result<()> {
    use std::os::unix::ffi::OsStringExt as _;

    let (dir, db) = Database::temporary()?;
    let file = dir
        .path()
        .join(std::ffi::OsString::from_vec(vec![b'n', 0xff]));
    fs::write(&file, b"lesson")?;
    let item = db.import_source(&file, None)?;
    assert_eq!(item.size_bytes, 6);
    assert_eq!(db.list_sources()?.len(), 1);
    Ok(())
}

#[test]
fn sizes_outside_the_limit_are_invalid_input() {
    for size in [0, MAX_SOURCE_BYTES + 1] {
        let error = check_source_size(size, "the file").unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput, "{size}");
    }
    let error = check_source_size(MAX_SOURCE_BYTES + 1, "the file").unwrap_err();
    assert_eq!(error.to_string(), "the file exceeds the 512 MiB limit");
    assert!(check_source_size(MAX_SOURCE_BYTES, "the file").is_ok());
}

const ADDRESS: &str = "https://example.com/lecture";

fn fetched_page() -> Fetched {
    Fetched {
        name: "Lecture notes".to_owned(),
        bytes: b"<html><body>Lecture</body></html>".to_vec(),
        kind: SourceKind::Web,
        mime: mime::HTML.to_owned(),
        uri: "https://example.com/lecture/notes".to_owned(),
    }
}

#[test]
fn adding_a_link_stores_its_address_and_queues_its_fetch() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let project = db.create_project("Physics")?;
    let (link, job) = db.add_link(Some(project.id), &format!(" {ADDRESS}\n"))?;
    assert_eq!(
        (link.kind, link.mime.as_str(), link.origin),
        (SourceKind::Link, mime::URI_LIST, SourceOrigin::Web)
    );
    assert_eq!(
        (link.name.as_str(), link.uri.as_deref()),
        (ADDRESS, Some(ADDRESS))
    );
    assert_eq!(link.project_id, Some(project.id));
    assert_eq!(
        db.read_source_bounded(link.id, 1024)?.as_deref(),
        Some(ADDRESS.as_bytes())
    );
    let jobs = db.jobs_for(JobTarget::Source(link.id))?;
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].id, jobs[0].kind, jobs[0].status),
        (job, JobKind::Fetch, JobStatus::Queued)
    );
    Ok(())
}

#[test]
fn a_fetch_replaces_the_link_with_what_its_address_holds() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (link, _) = db.add_link(None, ADDRESS)?;
    let fetched = fetched_page();
    let page = db
        .store_fetched(link.id, &fetched)?
        .expect("the link is there");
    assert_eq!(page.id, link.id);
    assert_eq!(
        (page.kind, page.mime.as_str(), page.name.as_str()),
        (SourceKind::Web, mime::HTML, "Lecture notes")
    );
    assert_eq!(page.uri.as_deref(), Some(fetched.uri.as_str()));
    assert_eq!(page.size_bytes, fetched.bytes.len() as i64);
    assert_eq!(
        page.sha256,
        <[u8; 32]>::from(Sha256::digest(&fetched.bytes))
    );
    assert_eq!(
        db.read_source_bounded(page.id, 1024)?,
        Some(fetched.bytes.clone())
    );
    assert_eq!(db.source(link.id)?, Some(page));
    Ok(())
}

#[test]
fn a_fetch_is_refused_when_empty_or_once_the_source_is_no_link() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (link, _) = db.add_link(None, ADDRESS)?;
    let empty = Fetched {
        bytes: Vec::new(),
        ..fetched_page()
    };
    let error = db.store_fetched(link.id, &empty).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput);
    let unnamed = Fetched {
        name: " \n".to_owned(),
        ..fetched_page()
    };
    let error = db.store_fetched(link.id, &unnamed).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput, "a blank name");
    assert_eq!(db.source(link.id)?, Some(link.clone()), "the link is kept");

    db.store_fetched(link.id, &fetched_page())?;
    let error = db.store_fetched(link.id, &fetched_page()).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput, "fetched already");

    let file = dir.path().join("notes.txt");
    fs::write(&file, b"notes")?;
    let imported = db.import_source(&file, None)?;
    let error = db.store_fetched(imported.id, &fetched_page()).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput, "an imported file");
    Ok(())
}

#[test]
fn a_fetch_for_a_deleted_source_stores_nothing() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    assert_eq!(db.store_fetched(SourceId::new(999), &fetched_page())?, None);
    assert!(db.list_sources()?.is_empty());
    Ok(())
}
