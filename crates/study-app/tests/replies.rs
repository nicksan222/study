//! Asking the assistant end to end: a note is only written down, and a note that mentions
//! the assistant gets a reply job against a mock chat API, citing what was read.

mod common;

use common::Fixture;
use study_ai::testing::RESPONSES_PATH;
use study_app::views::{JobKind, JobStatus, MessageRole, MessageStatus, PartContent, Place};
use study_core::{ErrorKind, Requirement};
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

/// Words from the answer agent's instructions, which tell its requests apart.
const ANSWER: &str = "You are the study assistant";

#[tokio::test(flavor = "multi_thread")]
async fn a_note_is_never_answered() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(ANSWER, "Should never be asked.").await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;

    fixture
        .post(session.id, "Mitochondria power the cell.", &[])
        .await?;

    let messages = fixture.app.messages(session.id)?;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, MessageRole::User);
    assert!(fixture.prompts(ANSWER).await.is_empty());
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_mention_is_answered_from_the_attached_file_and_cites_it() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture
        .answer(ANSWER, "Mitochondria make the cell's energy [1].")
        .await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;

    fixture
        .post(
            session.id,
            "@study what powers the cell?",
            &[("cells.txt", "mitochondria make atp")],
        )
        .await?;

    let reply = fixture.finished(JobKind::Reply).await?;
    assert_eq!(reply.status, JobStatus::Succeeded, "{:?}", reply.error);
    let messages = fixture.app.messages(session.id)?;
    let answer = &messages[1];
    assert_eq!(
        (answer.role, answer.status, answer.reply_to),
        (
            MessageRole::Assistant,
            MessageStatus::Complete,
            Some(messages[0].id)
        )
    );
    assert_eq!(
        answer.parts[0].content,
        PartContent::Text("Mitochondria make the cell's energy [1].".into())
    );
    assert_eq!(answer.citations.len(), 1);
    assert_eq!(answer.citations[0].source_name, "cells.txt");
    let prompts = fixture.prompts(ANSWER).await;
    assert_eq!(prompts.len(), 1, "asked once, after the file was read");
    assert!(prompts[0].contains("MITOCHONDRIA MAKE ATP"), "{prompts:?}");
    // The model reads the question, not the mention that asked for it.
    assert!(prompts[0].contains("what powers the cell?"));
    assert!(!prompts[0].contains("@study"), "{prompts:?}");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_sign_in_makes_the_reply_wait_as_an_auth_problem() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(ResponseTemplate::new(401).set_body_string("bad token"))
        .mount(&fixture.model)
        .await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;

    fixture
        .post(session.id, "@study what powers the cell?", &[])
        .await?;

    let failed = fixture
        .waiting(JobKind::Reply, Requirement::LanguageModels)
        .await?;
    assert_eq!(
        (failed.status, failed.waiting_for, failed.error_kind),
        (
            JobStatus::Waiting,
            Some(Requirement::LanguageModels),
            Some(ErrorKind::Auth)
        )
    );
    let answer = &fixture.app.messages(session.id)?[1];
    assert_eq!(answer.reply.as_ref().map(|job| job.id), Some(failed.id));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_mention_in_a_thread_is_answered_from_the_file_it_hangs_off() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(ANSWER, "They make ATP [1].").await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(session.id, "", &[("cells.txt", "mitochondria make atp")])
        .await?;
    let read = fixture.finished(JobKind::Extract).await?;
    assert_eq!(read.status, JobStatus::Succeeded, "{:?}", read.error);
    let root = fixture.app.messages(session.id)?[0].parts[0].id;

    fixture
        .post(Place::Thread(root), "@study what do they make?", &[])
        .await?;

    let reply = fixture.finished(JobKind::Reply).await?;
    assert_eq!(reply.status, JobStatus::Succeeded, "{:?}", reply.error);
    // The answer stays in the thread; the timeline only counts it.
    let timeline = fixture.app.messages(session.id)?;
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].parts[0].thread.replies, 2);
    let thread = fixture.app.thread(root)?.expect("a thread");
    let answer = &thread.replies[1];
    assert_eq!(
        (answer.role, answer.status, answer.thread_root),
        (MessageRole::Assistant, MessageStatus::Complete, Some(root))
    );
    // The question attached nothing: the file came from the thread.
    assert_eq!(answer.citations[0].source_name, "cells.txt");
    let prompts = fixture.prompts(ANSWER).await;
    assert!(prompts[0].contains("MITOCHONDRIA MAKE ATP"), "{prompts:?}");
    assert!(prompts[0].contains("cells.txt"), "{prompts:?}");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_finished_answer_is_written_again_when_asked() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture
        .answer(ANSWER, "Mitochondria make the cell's energy [1].")
        .await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(session.id, "@study what powers the cell?", &[])
        .await?;
    fixture.finished(JobKind::Reply).await?;
    let answer = fixture.app.messages(session.id)?[1].id;

    assert!(fixture.blocking(move |app| app.reanswer(answer)).await?);
    let id = session.id;
    fixture
        .blocking(move |app| {
            common::eventually(|| {
                Ok(app.messages(id)?[1].status == MessageStatus::Complete
                    && app.messages(id)?[1]
                        .reply
                        .as_ref()
                        .is_some_and(|job| job.status == JobStatus::Succeeded))
            })
        })
        .await?;
    assert_eq!(fixture.prompts(ANSWER).await.len(), 2, "written twice");
    Ok(())
}
