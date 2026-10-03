//! Rewriting a message end to end: a version is written by a job against a mock chat API,
//! from the active text and what was read from the message's files, and shown once done.

mod common;

use std::time::Duration;

use common::Fixture;
use study_ai::testing::{self, RESPONSES_PATH};
use study_app::views::{Asked, JobKind, JobStatus, MessageStatus, Rewrite, VersionOrigin};
use wiremock::Mock;
use wiremock::matchers::{body_string_contains, method, path};

/// Words from the rewrite agent's instructions, which tell its requests apart.
const REWRITE: &str = "You rewrite a student's text";

#[tokio::test(flavor = "multi_thread")]
async fn a_note_is_summarized_from_its_text_and_files_into_a_version_that_cites_them()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(REWRITE, "Mitochondria make ATP [1].").await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(
            session.id,
            "Today we saw that mitochondria power the cell.",
            &[("cells.txt", "mitochondria make atp")],
        )
        .await?;
    let note = fixture.app.messages(session.id)?[0].id;

    let asked = fixture
        .blocking(move |app| app.rewrite_message(note, &Rewrite::Summarize))
        .await?;
    assert!(matches!(asked, Asked::Queued(_)), "{asked:?}");
    let job = fixture.finished(JobKind::Rewrite).await?;
    assert_eq!(job.status, JobStatus::Succeeded, "{:?}", job.error);

    let message = &fixture.app.messages(session.id)?[0];
    assert_eq!(message.versions.len(), 2);
    assert_eq!(message.status, MessageStatus::Complete);
    let active = message.active().expect("a version is shown");
    assert_eq!(
        (active.number, active.origin),
        (2, VersionOrigin::Summarize)
    );
    assert_eq!(message.text(), "Mitochondria make ATP [1].");
    assert_eq!(message.citations.len(), 1);
    assert_eq!(message.citations[0].source_name, "cells.txt");
    // The first version is kept, and can be shown again.
    let first = message.versions[0].id;
    assert!(
        fixture
            .blocking(move |app| app.set_active_version(note, first))
            .await?
    );
    assert_eq!(
        fixture.app.messages(session.id)?[0].text(),
        "Today we saw that mitochondria power the cell."
    );

    let prompts = fixture.prompts(REWRITE).await;
    assert_eq!(prompts.len(), 1, "asked once, after the file was read");
    assert!(prompts[0].contains("Summarize the text"), "{prompts:?}");
    assert!(prompts[0].contains("MITOCHONDRIA MAKE ATP"), "{prompts:?}");
    assert!(prompts[0].contains("mitochondria power the cell"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn an_instruction_reaches_the_model_and_another_rewrite_waits_until_the_first_is_done()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(REWRITE, "Il testo, più formale.").await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(session.id, "mitochondria power the cell", &[])
        .await?;
    let note = fixture.app.messages(session.id)?[0].id;

    let (first, second) = fixture
        .blocking(move |app| {
            let how = Rewrite::Instruction("make it formal".into());
            Ok((
                app.rewrite_message(note, &how)?,
                app.rewrite_message(note, &how)?,
            ))
        })
        .await?;
    assert!(matches!(first, Asked::Queued(_)), "{first:?}");
    assert_eq!(second, Asked::Busy);
    fixture.finished(JobKind::Rewrite).await?;

    let message = &fixture.app.messages(session.id)?[0];
    assert_eq!(message.text(), "Il testo, più formale.");
    assert_eq!(
        message.active().unwrap().instruction.as_deref(),
        Some("make it formal")
    );
    let prompts = fixture.prompts(REWRITE).await;
    assert!(prompts[0].contains("make it formal"), "{prompts:?}");
    Ok(())
}

/// Words from the answer agent's instructions, which tell its requests apart.
const ANSWER: &str = "You are the study assistant";

#[tokio::test(flavor = "multi_thread")]
async fn an_improved_answer_is_revised_from_the_passages_it_cited_and_keeps_its_citations()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture
        .answer(ANSWER, "Mitochondria make the cell's energy [1].")
        .await;
    fixture
        .answer(REWRITE, "Mitochondria produce the energy of the cell [1].")
        .await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(
            session.id,
            "@study what powers the cell?",
            &[("cells.txt", "mitochondria make atp")],
        )
        .await?;
    fixture.finished(JobKind::Reply).await?;
    let answer = fixture.app.messages(session.id)?[1].id;

    let asked = fixture
        .blocking(move |app| app.rewrite_message(answer, &Rewrite::Improve))
        .await?;
    assert!(matches!(asked, Asked::Queued(_)), "{asked:?}");
    let job = fixture.finished(JobKind::Rewrite).await?;
    assert_eq!(job.status, JobStatus::Succeeded, "{:?}", job.error);

    // The rewriter was given the cited passage as source 1, the one the text's marker names.
    let prompts = fixture.prompts(REWRITE).await;
    assert_eq!(prompts.len(), 1);
    assert!(
        prompts[0].contains("<source n=\\\"1\\\" name=\\\"cells.txt\\\""),
        "{prompts:?}"
    );
    assert!(prompts[0].contains("MITOCHONDRIA MAKE ATP"), "{prompts:?}");
    let message = &fixture.app.messages(session.id)?[1];
    assert_eq!(message.versions.len(), 2);
    assert_eq!(
        message.text(),
        "Mitochondria produce the energy of the cell [1]."
    );
    assert_eq!(message.citations.len(), 1);
    assert_eq!(message.citations[0].source_name, "cells.txt");
    assert!(message.citations[0].quote.contains("MITOCHONDRIA MAKE ATP"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_note_without_files_is_rewritten_without_searching() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(REWRITE, "Mitochondria power cells.").await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(session.id, "mitochondria power the cell", &[])
        .await?;
    let note = fixture.app.messages(session.id)?[0].id;

    fixture
        .blocking(move |app| app.rewrite_message(note, &Rewrite::Improve))
        .await?;
    let job = fixture.finished(JobKind::Rewrite).await?;
    assert_eq!(job.status, JobStatus::Succeeded, "{:?}", job.error);

    let prompts = fixture.prompts(REWRITE).await;
    assert_eq!(prompts.len(), 1, "only the rewrite asked the model");
    assert!(!prompts[0].contains("<sources>"), "{prompts:?}");
    assert_eq!(
        fixture.app.messages(session.id)?[0].text(),
        "Mitochondria power cells."
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_stops_the_rewrite_it_replaces_and_nothing_stays_busy() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    // Slow enough that the edit comes while the model is still writing.
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .and(body_string_contains(REWRITE))
        .respond_with(testing::answer("Too late.").set_delay(Duration::from_secs(3)))
        .mount(&fixture.model)
        .await;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(session.id, "mitochondria power the cell", &[])
        .await?;
    let note = fixture.app.messages(session.id)?[0].id;
    fixture
        .blocking(move |app| app.rewrite_message(note, &Rewrite::Improve))
        .await?;
    // Wait for the model to be asked: the job is running.
    for _ in 0..200 {
        if !fixture.prompts(REWRITE).await.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(fixture.prompts(REWRITE).await.len(), 1);

    let edited = fixture
        .blocking(move |app| app.edit_message(note, "mitochondria power cells"))
        .await?;
    assert!(edited.is_some());

    // Nothing waits on the stopped job: another rewrite is asked for at once.
    let again = fixture
        .blocking(move |app| app.rewrite_message(note, &Rewrite::Summarize))
        .await?;
    assert!(matches!(again, Asked::Queued(_)), "{again:?}");
    let message = &fixture.app.messages(session.id)?[0];
    assert_eq!(message.text(), "mitochondria power cells");
    Ok(())
}
