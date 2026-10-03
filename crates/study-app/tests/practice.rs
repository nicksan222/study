//! Practice end to end against a mock chat API: questions written from a session's files,
//! one ahead of the student, a choice graded at once, an open answer graded by a model, and
//! earlier questions shown to the writer by their gists.

mod common;

use common::{Fixture, eventually};
use study_app::views::{
    Answered, Job, JobKind, JobStatus, Practice, PracticeAnswer, PracticeBody, QuestionKind,
    QuestionStatus, Verdict,
};
use study_core::{ErrorKind, PracticeId, SessionId};

/// Words from the question writer's instructions, which tell its requests apart.
const WRITER: &str = "You write quiz questions";
const GRADER: &str = "You grade students' answers";

const CHOICE: &str = "```json\n{\"type\": \"choice\", \"gist\": \"Where cells make ATP\", \
\"question\": \"Which organelle makes most of a cell's ATP?\", \"choices\": [\"Mitochondria\", \
\"Ribosomes\", \"Nucleus\"], \"answer\": 0, \"explanation\": \"Mitochondria make ATP [1].\", \
\"cites\": [1, 9]}\n```";
const OPEN: &str = "{\"type\": \"open\", \"gist\": \"Why cells need mitochondria\", \
\"question\": \"Why would a cell without mitochondria struggle?\", \"reference\": \"It could \
not make enough ATP, the energy it runs on.\", \"cites\": [1]}";

/// A session with a note and a file about cells, and a practice over it.
async fn practice(fixture: &Fixture) -> study_core::Result<(SessionId, PracticeId)> {
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(
            session.id,
            "Ribosomes build proteins.",
            &[("cells.txt", "mitochondria make atp")],
        )
        .await?;
    let project = fixture.project;
    let practice = fixture
        .blocking(move |app| app.project_practice(project))
        .await?;
    Ok((session.id, practice))
}

/// Waits until `practice` passes `check`, and returns it.
async fn until(
    fixture: &Fixture,
    practice: PracticeId,
    check: impl Fn(&Practice) -> bool + Send + 'static,
) -> study_core::Result<Practice> {
    fixture
        .blocking(move |app| {
            let now = || Ok(app.practice(practice)?.expect("the practice exists"));
            eventually(|| Ok(check(&now()?)))?;
            now()
        })
        .await
}

/// Whether the questions at `ordinals` of a practice are all ready.
fn ready(practice: &Practice, ordinals: &[usize]) -> bool {
    ordinals.iter().all(|&ordinal| {
        practice
            .questions
            .get(ordinal)
            .is_some_and(|question| question.status == QuestionStatus::Ready)
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn a_practice_writes_its_first_questions_from_a_sessions_file() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(WRITER, CHOICE).await;
    let (_, id) = practice(&fixture).await?;

    let practice = until(&fixture, id, |practice| ready(practice, &[0, 1])).await?;
    assert_eq!(practice.questions.len(), 2, "two ahead, no more");
    let first = &practice.questions[0];
    assert_eq!(first.kind, QuestionKind::Choice);
    let written = first.written.as_ref().expect("written");
    assert_eq!(written.gist, "Where cells make ATP");
    // Only markers that name a passage become citations.
    assert_eq!(first.citations.len(), 1);
    assert_eq!(first.citations[0].source_name, "cells.txt");
    assert_eq!(practice.score.asked, 2);

    let prompts = fixture.prompts(WRITER).await;
    assert_eq!(
        prompts.len(),
        2,
        "each written once, after the file was read"
    );
    assert!(prompts[0].contains("MITOCHONDRIA MAKE ATP"), "{prompts:?}");
    assert!(
        prompts[0].contains("Ribosomes build proteins."),
        "the notes"
    );
    assert!(prompts[0].contains("<kind>choice</kind>"), "{prompts:?}");
    let listed = fixture.blocking(|app| app.practices()).await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].project_id, fixture.project);
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_choice_is_graded_at_once_and_the_next_question_is_queued() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(WRITER, CHOICE).await;
    fixture.answer_when(WRITER, "<kind>open</kind>", OPEN).await;
    let (_, id) = practice(&fixture).await?;
    let practice = until(&fixture, id, |practice| ready(practice, &[0, 1])).await?;
    let first = practice.questions[0].id;
    // The choices may be turned, the right one with them.
    let Some(PracticeBody::Choice {
        choices, answer, ..
    }) = practice.questions[0]
        .written
        .as_ref()
        .map(|written| &written.body)
    else {
        panic!("a choice question");
    };
    assert_eq!(choices[*answer as usize], "Mitochondria");
    let wrong = (answer + 1) % choices.len() as u32;

    let answered = fixture
        .blocking(move |app| app.answer_question(first, &PracticeAnswer::Choice(wrong)))
        .await?;

    assert_eq!(answered, Answered::Graded(Verdict::Incorrect));
    let practice = until(&fixture, id, |practice| ready(practice, &[2])).await?;
    let graded = &practice.questions[0];
    assert_eq!(graded.status, QuestionStatus::Graded);
    assert_eq!(graded.answer, Some(PracticeAnswer::Choice(wrong)));
    let third = &practice.questions[2];
    assert_eq!(
        third.kind,
        QuestionKind::Open,
        "one question in three is open"
    );
    assert_eq!(
        third.written.as_ref().map(|written| written.gist.as_str()),
        Some("Why cells need mitochondria")
    );
    assert_eq!((practice.score.answered, practice.score.incorrect), (1, 1));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn an_open_answer_gets_a_verdict_and_feedback_from_a_model() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(WRITER, CHOICE).await;
    fixture.answer_when(WRITER, "<kind>open</kind>", OPEN).await;
    fixture
        .answer(
            GRADER,
            "{\"verdict\": \"partly\", \"feedback\": \"Right that it needs energy; say that \
             mitochondria make its ATP.\"}",
        )
        .await;
    let (_, id) = practice(&fixture).await?;
    for ordinal in 0..2 {
        let practice = until(&fixture, id, move |practice| ready(practice, &[ordinal])).await?;
        let question = practice.questions[ordinal].id;
        fixture
            .blocking(move |app| app.answer_question(question, &PracticeAnswer::Choice(0)))
            .await?;
    }
    let practice = until(&fixture, id, |practice| ready(practice, &[2])).await?;
    let open = practice.questions[2].id;

    let answered = fixture
        .blocking(move |app| {
            app.answer_question(open, &PracticeAnswer::Open("It would lack energy.".into()))
        })
        .await?;

    assert!(matches!(answered, Answered::Grading(_)));
    let grade = fixture.finished(JobKind::Grade).await?;
    assert_eq!(grade.status, JobStatus::Succeeded, "{:?}", grade.error);
    let practice = until(&fixture, id, move |practice| {
        practice.questions[2].status == QuestionStatus::Graded
    })
    .await?;
    let graded = &practice.questions[2];
    assert_eq!(graded.verdict, Some(Verdict::Partly));
    assert_eq!(
        graded.feedback.as_deref(),
        Some("Right that it needs energy; say that mitochondria make its ATP.")
    );
    assert_eq!(
        (
            practice.score.answered,
            practice.score.correct,
            practice.score.partly
        ),
        (3, 2, 1)
    );

    let prompts = fixture.prompts(GRADER).await;
    assert_eq!(prompts.len(), 1);
    // The grader reads the question in full, its reference, what it cites and the answer,
    // and nothing of the other questions.
    assert!(prompts[0].contains("Why would a cell without mitochondria struggle?"));
    assert!(prompts[0].contains("It could not make enough ATP"));
    assert!(prompts[0].contains("MITOCHONDRIA MAKE ATP"));
    assert!(prompts[0].contains("It would lack energy."));
    assert!(!prompts[0].contains("Where cells make ATP"), "{prompts:?}");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn earlier_questions_reach_the_writer_by_their_gists_only() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture.answer(WRITER, CHOICE).await;
    let (_, id) = practice(&fixture).await?;

    until(&fixture, id, |practice| ready(practice, &[0, 1])).await?;

    let prompts = fixture.prompts(WRITER).await;
    assert!(
        !prompts[0].contains("<asked>\\n"),
        "nothing asked before the first"
    );
    assert!(prompts[1].contains("<asked>\\n- Where cells make ATP\\n</asked>"));
    assert!(
        !prompts[1].contains("Which organelle makes most"),
        "never the full question: {prompts:?}"
    );
    Ok(())
}

/// Words from the sifter's instructions.
const SIFTER: &str = "You sift a student's material";

#[tokio::test(flavor = "multi_thread")]
async fn questions_skip_small_talk_and_a_practice_sifts_its_material_once() -> study_core::Result<()>
{
    let fixture = Fixture::start().await?;
    fixture.answer(WRITER, CHOICE).await;
    // The first passage is small talk; every other one is worth studying.
    fixture
        .answer(SIFTER, "{\"keep\": [2, 3, 4, 5, 6, 7, 8, 9, 10]}")
        .await;
    let small_talk = "good morning everyone, can you hear me at the back? ".repeat(12);
    let lecture: Vec<String> = ["mitochondria", "ribosomes", "lysosomes", "chloroplasts"]
        .iter()
        .map(|part| format!("the {part} of the cell do important work. ").repeat(30))
        .collect();
    let contents = format!("{small_talk}\n\n{}", lecture.join("\n\n"));
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(session.id, "Lecture 4", &[("lecture.txt", &contents)])
        .await?;
    let project = fixture.project;
    let id = fixture
        .blocking(move |app| app.project_practice(project))
        .await?;

    until(&fixture, id, |practice| ready(practice, &[0, 1])).await?;
    let written = fixture.prompts(WRITER).await;
    assert_eq!(written.len(), 2);
    for prompt in &written {
        assert!(!prompt.contains("CAN YOU HEAR ME"), "{prompt}");
    }
    let sifted = fixture.prompts(SIFTER).await;
    assert_eq!(
        sifted.len(),
        1,
        "each passage sifted once for the whole practice"
    );
    assert!(sifted[0].contains("CAN YOU HEAR ME"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_question_of_the_wrong_kind_is_asked_for_again() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    // The first question is a choice; the model writes an open one instead.
    fixture.answer(WRITER, OPEN).await;
    let (_, id) = practice(&fixture).await?;

    let job = fixture
        .blocking(|app| {
            let failed = || -> study_core::Result<Option<Job>> {
                Ok(app
                    .job_overviews(50)?
                    .into_iter()
                    .map(|overview| overview.job)
                    .find(|job| job.kind == JobKind::Question && job.error_kind.is_some()))
            };
            eventually(|| Ok(failed()?.is_some()))?;
            Ok(failed()?.expect("a failed attempt"))
        })
        .await?;

    assert_eq!(job.error_kind, Some(ErrorKind::Transient));
    assert_eq!(job.status, JobStatus::Queued, "to be asked again");
    let error = job.error.unwrap_or_default();
    assert!(
        error.contains("choice") && error.contains("open"),
        "names the kind asked and the kind written: {error}"
    );
    let practice = fixture
        .blocking(move |app| Ok(app.practice(id)?.expect("the practice exists")))
        .await?;
    assert!(!ready(&practice, &[0]), "nothing of the wrong kind is kept");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_practice_over_nothing_read_is_refused_without_asking_a_model() -> study_core::Result<()>
{
    let fixture = Fixture::start().await?;
    fixture.answer(WRITER, CHOICE).await;
    fixture.app.create_session(fixture.project, "Empty")?;
    let project = fixture.project;
    fixture
        .blocking(move |app| app.project_practice(project))
        .await?;

    let job = fixture.finished(JobKind::Question).await?;

    assert_eq!(
        (job.status, job.error_kind),
        (JobStatus::Failed, Some(ErrorKind::Unsupported))
    );
    assert!(fixture.prompts("").await.is_empty(), "no model was asked");
    Ok(())
}
