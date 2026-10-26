//! Sources made in Study: typed notes, and pages fetched from a real web server, nginx in
//! Docker.

mod common;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use common::eventually;
use study_app::pipeline::{ExtractorSet, TextExtractor, WebExtractor};
use study_app::views::{Job, JobKind, JobStatus, Source};
use study_app::{App, Preview};
use study_core::{ErrorKind, SourceId, SourceKind, SourceOrigin};
use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};

/// An app that reads with Study's own text and web extractors.
fn app(dir: &tempfile::TempDir) -> study_core::Result<App> {
    common::started(
        dir,
        ExtractorSet::new(vec![Arc::new(TextExtractor), Arc::new(WebExtractor)]),
    )
}

#[test]
fn a_typed_note_is_stored_and_read() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = app(&dir)?;
    let project = app.create_project("Biology")?;
    let note = app.create_note(Some(project.id), "Cells", "Mitochondria power the cell.")?;
    assert_eq!(
        (note.kind, note.origin),
        (SourceKind::Note, SourceOrigin::Note)
    );
    eventually(|| Ok(app.source_document(note.id)?.is_some()))?;
    let document = app.source_document(note.id)?.unwrap();
    assert_eq!(document.text(), "Mitochondria power the cell.");
    assert!(app.create_note(None, "Empty", "  ").is_err());
    Ok(())
}

#[test]
fn a_long_text_preview_ends_on_a_whole_character() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = app(&dir)?;
    // Two-byte characters after one byte, so the 32 KiB cut falls inside one.
    let contents = format!("a{}", "è".repeat(20_000));
    let path = common::write(&dir, "notes.txt", &contents)?;
    let source = app.import_file(&path, None)?;

    let Preview::Text(text) = app.preview(&source)? else {
        panic!("a text file previews as text");
    };
    assert!(text.ends_with("è…"));
    assert!(!text.contains('\u{FFFD}'));
    assert!(contents.starts_with(text.trim_end_matches('…')));
    Ok(())
}

/// A mock web server, and the address of its page about cells.
async fn web_server() -> (MockServer, String) {
    let server = MockServer::start().await;
    let url = format!("{}/cells.html", server.uri());
    (server, url)
}

/// The page about cells, as a web server answers it.
fn cells_page() -> ResponseTemplate {
    let page = std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/web/cells.html"),
    )
    .expect("the fixture page");
    ResponseTemplate::new(200).set_body_raw(page, "text/html; charset=utf-8")
}

/// The Fetch job of `app`, once it passes `check`.
async fn fetch_job(
    app: &App,
    check: impl Fn(&Job) -> bool + Send + 'static,
) -> study_core::Result<Job> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let find_fetch = || -> study_core::Result<Option<Job>> {
            Ok(app
                .job_overviews(50)?
                .into_iter()
                .map(|overview| overview.job)
                .find(|job| job.kind == JobKind::Fetch))
        };
        eventually(|| Ok(find_fetch()?.is_some_and(|job| check(&job))))?;
        Ok(find_fetch()?.expect("the fetch job"))
    })
    .await?
}

/// Waits until link `id` of `app` has been fetched and read, and returns it.
async fn read_page(app: &App, id: SourceId) -> study_core::Result<Source> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        eventually(|| Ok(app.source_document(id)?.is_some()))?;
        Ok(app.source(id)?.expect("the same source"))
    })
    .await?
}

#[test]
fn a_link_no_fetcher_takes_is_refused_at_once() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = app(&dir)?;
    let refused = app.add_link(None, "ftp://example.com/notes").unwrap_err();
    assert_eq!(refused.kind(), ErrorKind::Unsupported);
    assert!(app.sources()?.is_empty(), "nothing stored");

    // Before background work starts, there is nothing to fetch with.
    let idle_dir = tempfile::tempdir()?;
    let idle = common::open(&idle_dir)?;
    assert!(idle.add_link(None, "https://example.com/notes").is_err());
    assert!(idle.sources()?.is_empty());
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_link_whose_page_was_missing_is_read_when_retried() -> study_core::Result<()> {
    let (server, url) = web_server().await;
    Mock::given(path("/cells.html"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir()?;
    let app = app(&dir)?;
    let link = app.add_link(None, &url)?;

    let failed = fetch_job(&app, |job| job.status.is_terminal()).await?;
    assert_eq!(
        (failed.status, failed.error_kind),
        (JobStatus::Failed, Some(ErrorKind::NotFound))
    );

    server.reset().await;
    Mock::given(path("/cells.html"))
        .respond_with(cells_page())
        .mount(&server)
        .await;
    assert!(app.retry_job(failed.id)?);
    let page = read_page(&app, link.id).await?;
    assert_eq!(
        (page.kind, page.name.as_str()),
        (SourceKind::Web, "All about cells")
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fetch_interrupted_by_quitting_is_done_at_the_next_start() -> study_core::Result<()> {
    let (server, url) = web_server().await;
    // The first request hangs, so quitting interrupts it; later ones get the page.
    Mock::given(path("/cells.html"))
        .respond_with(cells_page().set_delay(Duration::from_secs(60)))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(path("/cells.html"))
        .respond_with(cells_page())
        .mount(&server)
        .await;
    let dir = tempfile::tempdir()?;
    let quitting = app(&dir)?;
    let link = quitting.add_link(None, &url)?;
    fetch_job(&quitting, |job| job.status == JobStatus::Running).await?;
    // Running is marked before the request leaves: quit only once it hangs on the server.
    let requested = async {
        while server
            .received_requests()
            .await
            .unwrap_or_default()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), requested)
        .await
        .expect("the fetch reaches the server");
    drop(quitting);

    let app = app(&dir)?;
    let page = read_page(&app, link.id).await?;
    assert_eq!(
        (page.kind, page.uri.as_deref()),
        (SourceKind::Web, Some(url.as_str()))
    );
    Ok(())
}

mod docker {
    use std::path::PathBuf;

    use study_app::views::{Anchor, JobKind};
    use study_core::{SourceKind, SourceOrigin};
    use study_testkit::web::Site;

    use super::app;
    use super::common::{eventually, succeeded};

    #[tokio::test(flavor = "multi_thread")]
    async fn a_web_page_is_fetched_titled_and_read_by_section() -> study_core::Result<()> {
        let site = Site::serve(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/web"),
            &[],
        )
        .await;
        let dir = tempfile::tempdir()?;
        let app = app(&dir)?;
        let url = site.url("/cells.html");

        // The link is stored at once; fetching it is a job.
        let link = app.add_link(None, &url)?;
        assert_eq!(
            (link.kind, link.origin),
            (SourceKind::Link, SourceOrigin::Web)
        );

        let (page, document) = tokio::task::spawn_blocking(move || -> study_core::Result<_> {
            eventually(|| succeeded(&app, JobKind::Index))?;
            let page = app.source(link.id)?.expect("the same source");
            Ok((page, app.source_document(link.id)?.expect("read")))
        })
        .await??;
        assert_eq!(page.name, "All about cells");
        assert_eq!(page.uri.as_deref(), Some(url.as_str()));
        assert_eq!(
            (page.kind, page.origin),
            (SourceKind::Web, SourceOrigin::Web)
        );
        assert_eq!(
            document.blocks[1].anchor,
            Anchor::Url {
                url,
                fragment: Some("energy".into())
            }
        );
        Ok(())
    }
}
