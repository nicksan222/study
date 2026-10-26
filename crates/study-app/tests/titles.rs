//! Naming sessions end to end: title jobs against a mock chat API.

mod common;

use common::Fixture;
use study_ai::testing::{RESPONSES_PATH, answer};
use study_app::views::{JobKind, JobStatus, TitleSource};
use study_core::{ErrorKind, Requirement};
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

/// Words from the title agent's instructions, which tell its requests apart.
const TITLE: &str = "You name study sessions";

/// Waits until the latest title job has ended; returns how.
async fn titled(fixture: &Fixture) -> study_core::Result<(JobStatus, Option<ErrorKind>)> {
    let job = fixture.finished(JobKind::Title).await?;
    Ok((job.status, job.error_kind))
}

#[tokio::test(flavor = "multi_thread")]
async fn a_first_message_names_its_session() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(TITLE, "\"Mitochondria basics.\"").await;
    let session = fixture
        .app
        .create_untitled_session(fixture.project, "what do mitochondria do")?;

    fixture
        .post(session.id, "What do mitochondria do in a cell?", &[])
        .await?;

    assert_eq!(titled(&fixture).await?, (JobStatus::Succeeded, None));
    let named = fixture.session(session.id)?;
    assert_eq!(named.title, "Mitochondria basics");
    assert_eq!(named.title_source, TitleSource::Generated);
    let prompts = fixture.prompts(TITLE).await;
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].contains("You name study sessions"));
    assert!(prompts[0].contains("What do mitochondria do in a cell?"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_message_with_files_is_named_once_they_are_read() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(TITLE, "Krebs cycle").await;
    let session = fixture
        .app
        .create_untitled_session(fixture.project, "lecture.txt")?;

    fixture
        .post(session.id, "", &[("lecture.txt", "today: the krebs cycle")])
        .await?;

    assert_eq!(titled(&fixture).await?.0, JobStatus::Succeeded);
    let prompts = fixture.prompts(TITLE).await;
    assert_eq!(prompts.len(), 1, "asked once, after the file was read");
    let jobs: Vec<_> = fixture
        .app
        .job_overviews(20)?
        .into_iter()
        .map(|overview| (overview.job.kind, overview.job.status, overview.job.error))
        .collect();
    assert!(
        prompts[0].contains("TODAY: THE KREBS CYCLE"),
        "{prompts:?} {jobs:?}"
    );
    assert_eq!(fixture.session(session.id)?.title, "Krebs cycle");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn asking_again_renames_even_a_typed_title_from_the_whole_conversation()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(TITLE, "Cell respiration").await;
    let session = fixture.app.create_session(fixture.project, "My notes")?;
    fixture
        .post(session.id, "Start with glycolysis", &[])
        .await?;
    fixture
        .post(session.id, "Now the electron transport chain", &[])
        .await?;
    // A typed title is never renamed on its own: no title job was queued.
    assert!(fixture.prompts(TITLE).await.is_empty());
    assert_eq!(fixture.session(session.id)?.title, "My notes");

    fixture.app.regenerate_title(session.id)?;

    assert_eq!(titled(&fixture).await?.0, JobStatus::Succeeded);
    let renamed = fixture.session(session.id)?;
    assert_eq!(renamed.title, "Cell respiration");
    assert_eq!(renamed.title_source, TitleSource::Generated);
    let prompts = fixture.prompts(TITLE).await;
    assert!(prompts[0].contains("Start with glycolysis"));
    assert!(prompts[0].contains("Now the electron transport chain"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn asking_for_a_title_twice_before_it_is_written_asks_once() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    // A slow answer, so the title is still being written when it is asked for again.
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(answer("Cell respiration").set_delay(std::time::Duration::from_millis(500)))
        .mount(&fixture.model)
        .await;
    let session = fixture.app.create_session(fixture.project, "My notes")?;
    fixture.post(session.id, "Glycolysis", &[]).await?;

    let first = fixture.app.regenerate_title(session.id)?;
    assert_eq!(fixture.app.regenerate_title(session.id)?, first);
    assert_eq!(fixture.app.sessions_being_titled()?, vec![session.id]);

    assert_eq!(titled(&fixture).await?.0, JobStatus::Succeeded);
    assert!(fixture.app.sessions_being_titled()?.is_empty());
    assert_eq!(fixture.prompts(TITLE).await.len(), 1);
    // Once written, asking again names it again.
    assert_ne!(fixture.app.regenerate_title(session.id)?, first);
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_sign_in_makes_the_title_wait_as_an_auth_problem_and_keeps_the_title()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(ResponseTemplate::new(401).set_body_string("bad token"))
        .mount(&fixture.model)
        .await;
    let session = fixture.app.create_session(fixture.project, "My notes")?;
    fixture.post(session.id, "Glycolysis", &[]).await?;

    fixture.app.regenerate_title(session.id)?;

    let job = fixture
        .waiting(JobKind::Title, Requirement::LanguageModels)
        .await?;
    assert_eq!(
        (job.status, job.waiting_for, job.error_kind),
        (
            JobStatus::Waiting,
            Some(Requirement::LanguageModels),
            Some(ErrorKind::Auth)
        )
    );
    assert_eq!(fixture.session(session.id)?.title, "My notes");
    Ok(())
}

#[test]
fn without_a_model_the_title_waits_as_a_setting_to_fix() -> study_core::Result<()> {
    let dir = tempfile::tempdir()?;
    let app = common::started(&dir, common::shout())?;
    let project = app.create_project("Biology")?.id;
    let session = app.create_untitled_session(project, "what do mitochondria do")?;

    app.post_message(session.id, "What do mitochondria do?", &[])?;

    let job = common::waiting(&app, JobKind::Title, Requirement::LanguageModels)?;
    assert_eq!(
        (job.status, job.waiting_for, job.error_kind),
        (
            JobStatus::Waiting,
            Some(Requirement::LanguageModels),
            Some(ErrorKind::Config)
        )
    );
    let session = app.session(session.id)?.expect("the session");
    assert_eq!(session.title_source, TitleSource::Provisional);
    Ok(())
}
