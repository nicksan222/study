//! Rewriting a message end to end: a version is written by a job against a mock chat API,
//! from the active text and what was read from the message's files, and shown once done.

mod common;

use common::Fixture;
use study_app::views::{Asked, JobKind, JobStatus, MessageStatus, Rewrite, VersionOrigin};

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
