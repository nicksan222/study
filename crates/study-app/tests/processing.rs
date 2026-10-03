//! The processing switches end to end: what the user switches off for a kind of file is not
//! run for it, from reading through the index to the material offered.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use common::{Fixture, eventually, open, start, started, succeeded, write};
use study_app::App;
use study_app::pipeline::ExtractorSet;
use study_app::views::{Anchor, Block, BlockKind, Document, JobKind, JobStatus};
use study_core::db::{Database, JobTarget, NewJob};
use study_core::processing::{
    BoxFuture, Extractor, ExtractorKind, Processor, RefinerKind, SourceInput,
};
use study_core::{ArtifactKind, ErrorKind, Failure, JobId, SourceId, SourceKind, Stamp};

/// The kinds of every job so far, oldest first.
fn job_kinds(app: &App) -> study_core::Result<Vec<JobKind>> {
    let mut kinds: Vec<JobKind> = app
        .job_overviews(50)?
        .into_iter()
        .map(|overview| overview.job.kind)
        .collect();
    kinds.reverse();
    Ok(kinds)
}

/// Waits for the jobs to settle: every one ended, and nothing new queued for a moment.
async fn settled(fixture: &Fixture) -> study_core::Result<()> {
    let all_ended = |app: &App| {
        eventually(|| {
            Ok(app
                .job_overviews(50)?
                .iter()
                .all(|overview| overview.job.status.is_terminal()))
        })
    };
    fixture.blocking(all_ended).await?;
    tokio::time::sleep(Duration::from_millis(150)).await;
    fixture.blocking(all_ended).await
}

fn switch(fixture: &Fixture, processor: Processor, on: bool) -> study_core::Result<()> {
    fixture
        .app
        .switch_processor(SourceKind::Text, processor, on)
}

#[tokio::test(flavor = "multi_thread")]
async fn reading_switched_off_leaves_files_unread_until_switched_back_on() -> study_core::Result<()>
{
    let fixture = Fixture::start().await?;
    switch(&fixture, Processor::Extractor(ExtractorKind::Text), false)?;
    let source = fixture.import("notes.txt", "cells").await?;
    settled(&fixture).await?;
    assert!(job_kinds(&fixture.app)?.is_empty());
    assert_eq!(fixture.app.source_document(source.id)?, None);

    // Switching reading back on reads what waited.
    switch(&fixture, Processor::Extractor(ExtractorKind::Text), true)?;
    fixture
        .blocking(move |app| eventually(|| Ok(app.source_document(source.id)?.is_some())))
        .await?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn index_switched_off_skips_the_index_and_the_embeddings_built_on_it()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    switch(&fixture, Processor::Stage(JobKind::Index), false)?;
    fixture.import("notes.txt", "cells").await?;
    assert_eq!(
        fixture.finished(JobKind::Extract).await?.status,
        JobStatus::Succeeded
    );
    settled(&fixture).await?;
    assert_eq!(job_kinds(&fixture.app)?, [JobKind::Extract]);
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn embed_switched_off_indexes_but_never_embeds() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    switch(&fixture, Processor::Stage(JobKind::Embed), false)?;
    fixture.import("notes.txt", "cells").await?;
    fixture.finished(JobKind::Index).await?;
    settled(&fixture).await?;
    assert_eq!(job_kinds(&fixture.app)?, [JobKind::Extract, JobKind::Index]);
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn by_default_a_file_is_read_indexed_and_embedded() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.import("notes.txt", "cells").await?;
    fixture.finished(JobKind::Embed).await?;
    settled(&fixture).await?;
    assert_eq!(
        job_kinds(&fixture.app)?,
        [JobKind::Extract, JobKind::Index, JobKind::Embed]
    );
    Ok(())
}

/// Reads text back as the text extractor, counting its reads.
struct Counting(Arc<AtomicUsize>);

impl Extractor for Counting {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Text
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            Ok(Document {
                blocks: vec![Block {
                    kind: BlockKind::Paragraph,
                    text: String::from_utf8_lossy(&input.bytes).into_owned(),
                    anchor: Anchor::Paragraph { index: 0 },
                }],
                ..Document::default()
            })
        })
    }
}

#[test]
fn identical_files_are_read_once_and_record_their_refiners() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let reads = Arc::new(AtomicUsize::new(0));
    let app = started(
        &dir,
        ExtractorSet::new(vec![Arc::new(Counting(reads.clone()))]),
    )?;
    let mut documents = Vec::new();
    for name in ["a.txt", "b.txt"] {
        let path = write(&dir, name, "same words")?;
        let source = app.import_file(&path, None)?;
        eventually(|| Ok(app.source_document(source.id)?.is_some()))?;
        documents.push(app.source_document(source.id)?.unwrap());
    }
    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "the copy reused the first read"
    );
    assert_eq!(documents[0], documents[1]);
    assert_eq!(
        documents[0].meta.refiners,
        [Stamp {
            refiner: RefinerKind::Whitespace,
            version: 2,
        }]
    );
    Ok(())
}

/// An app with a text file stored while work has not started, and a second connection to
/// its database, for a test to leave it as an earlier run would have.
fn stored_before_work(dir: &tempfile::TempDir) -> study_core::Result<(App, SourceId, Database)> {
    let app = open(dir)?;
    let source = app.import_file(&write(dir, "notes.txt", "cells")?, None)?;
    Ok((app, source.id, Database::open(common::database(dir))?))
}

/// An app with a stored text file read into a document that was never indexed, as a read
/// cut off just before its Index job was queued leaves it. Work has not started.
fn read_but_not_indexed(dir: &tempfile::TempDir) -> study_core::Result<App> {
    let (app, source, database) = stored_before_work(dir)?;
    database.save_document(
        source,
        &Document {
            blocks: vec![Block {
                kind: BlockKind::Paragraph,
                text: "CELLS".into(),
                anchor: Anchor::Paragraph { index: 0 },
            }],
            ..Document::default()
        },
    )?;
    Ok(app)
}

/// A read of `source`, queued and claimed as a worker of an earlier run would have.
fn claimed_read(database: &Database, source: SourceId) -> study_core::Result<JobId> {
    database.enqueue_job(&NewJob::new(JobKind::Extract, JobTarget::Source(source)))?;
    Ok(database
        .claim_job(&[JobKind::Extract])?
        .expect("the read")
        .id)
}

#[test]
fn a_read_whose_index_never_ran_is_indexed_when_work_starts() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = read_but_not_indexed(&dir)?;
    start(&app)?;
    eventually(|| succeeded(&app, JobKind::Index))?;
    Ok(())
}

#[test]
fn nothing_is_indexed_when_work_starts_if_the_index_is_switched_off() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = read_but_not_indexed(&dir)?;
    app.switch_processor(SourceKind::Text, Processor::Stage(JobKind::Index), false)?;
    start(&app)?;
    std::thread::sleep(Duration::from_millis(150));
    assert!(app.job_overviews(10)?.is_empty());
    // Switching it back on catches up.
    app.switch_processor(SourceKind::Text, Processor::Stage(JobKind::Index), true)?;
    eventually(|| {
        Ok(app
            .job_overviews(10)?
            .iter()
            .any(|overview| overview.job.kind == JobKind::Index))
    })?;
    Ok(())
}

#[test]
fn a_read_skipped_while_reading_was_off_is_read_once_it_is_back_on() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let (app, source, database) = stored_before_work(&dir)?;
    // A read that ran while reading was off: it succeeded, leaving no document.
    let job = claimed_read(&database, source)?;
    database.succeed_job(job, &[])?;
    start(&app)?;
    eventually(|| Ok(app.source_document(source)?.is_some()))?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn material_switched_off_is_not_made() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.import("notes.txt", "cells").await?;
    fixture.app.switch_processor(
        SourceKind::Text,
        Processor::Enhancer(ArtifactKind::Diagram),
        false,
    )?;
    let refused = fixture
        .app
        .update_material(fixture.project, ArtifactKind::Diagram)
        .unwrap_err();
    assert_eq!(refused.kind(), ErrorKind::Unsupported);
    assert!(fixture.app.material(fixture.project)?.is_empty());
    // What is still offered is made.
    fixture
        .app
        .update_material(fixture.project, ArtifactKind::Notes)?;
    assert_eq!(fixture.app.material(fixture.project)?.len(), 1);
    Ok(())
}

#[test]
fn a_failed_read_waits_for_the_user_rather_than_retrying_at_start() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let (app, source, database) = stored_before_work(&dir)?;
    let job = claimed_read(&database, source)?;
    database.fail_job(
        job,
        &Failure::new(ErrorKind::InvalidInput, "unreadable"),
        None,
    )?;
    start(&app)?;
    std::thread::sleep(Duration::from_millis(150));
    let reads = app
        .job_overviews(10)?
        .into_iter()
        .filter(|overview| overview.job.kind == JobKind::Extract)
        .count();
    assert_eq!(reads, 1, "only the failed read, not a new one");
    assert_eq!(app.source_document(source)?, None);
    Ok(())
}
