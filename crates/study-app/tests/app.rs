//! The app end to end on a temporary database, with an extractor that never loads a model.

mod common;

use common::{eventually, open, shout, start, started, succeeded, write};
use study_app::App;
use study_app::views::{Anchor, JobKind, JobStatus, SearchKind, SearchTarget};
use study_core::{ErrorKind, SourceKind};

#[test]
fn an_imported_file_is_read_indexed_and_found_at_its_line() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = started(&dir, shout())?;
    let project = app.create_project("Biology")?;
    let file = write(&dir, "notes.txt", "cells\nmitochondria make energy")?;

    let missing = dir.path().join("missing.txt");
    let mut results = app
        .import_files(&[missing, file], Some(project.id))
        .into_iter();
    assert!(results.next().unwrap().is_err());
    let source = results.next().unwrap()?;
    assert_eq!(source.kind, SourceKind::Text);
    eventually(|| succeeded(&app, JobKind::Index))?;

    let document = app.source_document(source.id)?.expect("read");
    assert_eq!(document.text(), "CELLS\n\nMITOCHONDRIA MAKE ENERGY");
    assert_eq!(
        document.meta.extractor,
        Some(study_core::processing::ExtractorKind::Text)
    );

    let hits = app.search("mitochondria", 10)?.hits;
    let passage = hits
        .iter()
        .find(|hit| hit.kind == SearchKind::Source && hit.excerpt.is_some())
        .expect("a passage");
    let SearchTarget::Source {
        source_id, anchor, ..
    } = &passage.target
    else {
        panic!("a passage opens its source");
    };
    assert_eq!(*source_id, source.id);
    assert!(matches!(anchor, Some(Anchor::Text { line_start: 1, .. })));
    Ok(())
}

#[test]
fn a_corrected_block_is_indexed_again_and_found() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = started(&dir, shout())?;
    let file = write(&dir, "lecture.txt", "the sell divides")?;
    let source = app.import_file(&file, None)?;
    eventually(|| succeeded(&app, JobKind::Index))?;
    let before = app.source_document(source.id)?.expect("read").blocks[0]
        .text
        .clone();

    assert!(app.correct_block(source.id, 0, &before, "the cell divides")?);
    assert!(!app.correct_block(source.id, 0, &before, "stale")?);
    assert_eq!(
        app.source_document(source.id)?.expect("read").text(),
        "the cell divides"
    );
    eventually(|| {
        Ok(app
            .search("cell", 10)?
            .hits
            .iter()
            .any(|hit| hit.kind == SearchKind::Source && hit.excerpt.is_some()))
    })?;
    Ok(())
}

#[test]
fn a_failed_read_keeps_its_kind_and_can_be_retried() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = started(&dir, shout())?;
    let file = write(&dir, "broken.txt", "please fail")?;
    app.import_file(&file, None)?;
    let failed = || -> study_core::Result<Option<_>> {
        Ok(app
            .job_overviews(10)?
            .into_iter()
            .find(|overview| overview.job.status == JobStatus::Failed))
    };
    eventually(|| Ok(failed()?.is_some()))?;
    let job = failed()?.unwrap().job;
    assert_eq!(job.error_kind, Some(ErrorKind::InvalidInput));
    assert!(app.retry_job(job.id)?);
    Ok(())
}

#[test]
fn files_stored_while_nothing_ran_are_read_when_work_starts() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = open(&dir)?;
    let file = write(&dir, "early.txt", "early")?;
    let source = app.import_file(&file, None)?;
    assert!(app.job_overviews(10)?.is_empty());

    start(&app)?;
    eventually(|| Ok(app.source_document(source.id)?.is_some()))?;
    Ok(())
}

#[test]
fn an_unopenable_database_reports_why_from_every_call() -> study_core::Result<()> {
    let app = App::open("/nonexistent-dir/study.sqlite3")?;
    assert!(app.projects().is_err());
    assert!(start(&app).is_err());
    Ok(())
}

#[test]
fn posting_needs_background_work_but_reading_does_not() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = open(&dir)?;
    let project = app.create_project("Biology")?;
    let session = app.create_session(project.id, "Cells")?;
    assert!(app.post_message(session.id, "hello", &[]).is_err());
    assert_eq!(app.all_sessions()?, std::slice::from_ref(&session));

    start(&app)?;
    // A note is only written down.
    app.post_message(session.id, "hello", &[])?;
    assert_eq!(app.messages(session.id)?.len(), 1);
    // Asking the assistant by name adds its answer, waiting to be written.
    app.post_message(session.id, "@study what is a cell?", &[])?;
    assert_eq!(app.messages(session.id)?.len(), 3);
    Ok(())
}

#[test]
fn the_plan_fills_settings_the_user_never_chose_and_nothing_else() -> study_core::Result<()> {
    use study_app::benchmark::{Placement, Plan};
    use study_app::stt::TranscriptionPreferences;

    let dir = tempfile::tempdir()?;
    let app = open(&dir)?;
    let plan = Plan {
        transcription: Placement::Local,
        transcription_instances: study_app::stt::ModelCopies::new(3),
    };
    assert!(app.apply_plan(&plan)?);
    let applied: TranscriptionPreferences = app.preferences()?;
    assert_eq!(applied.local_instances.get(), 3);

    // Once the user saved a value, the plan leaves it alone.
    let mut chosen = applied;
    chosen.local_instances = study_app::preferences::Count::new(1).unwrap();
    app.save_preferences(&chosen)?;
    assert!(!app.apply_plan(&plan)?);
    assert_eq!(
        app.preferences::<TranscriptionPreferences>()?
            .local_instances
            .get(),
        1
    );
    Ok(())
}
