//! Starting, writing, answering, grading, listing and deleting practices.

use super::UNANSWERED;
use super::ask::AHEAD;
use crate::db::{Answered, Database, JobTarget, MessageRole, NewPart, PracticeScore};
use crate::{
    Anchor, Citation, ErrorKind, JobKind, JobStatus, PracticeAnswer, PracticeBody, PracticeId,
    ProjectId, QuestionId, QuestionKind, QuestionStatus, Result, SessionId, Verdict,
    WrittenQuestion,
};
use std::path::Path;

fn read_everything(_: crate::SourceKind, _: &str) -> bool {
    true
}

/// A new project with a session in it; see [`session_in`].
fn session(db: &Database, dir: &Path, project: &str, note: &str) -> Result<(ProjectId, SessionId)> {
    let project = db.create_project(project)?.id;
    Ok((project, session_in(db, dir, project, note)?))
}

/// A session in `project` with a note and an attached file, whose read is queued.
fn session_in(db: &Database, dir: &Path, project: ProjectId, note: &str) -> Result<SessionId> {
    let session = db.create_session(project, note)?;
    let file = dir.join(format!("{}.txt", session.id));
    std::fs::write(&file, note)?;
    db.post_message(
        session.id,
        MessageRole::User,
        &[NewPart::Text(note.to_owned()), NewPart::File(file)],
        &read_everything,
    )?;
    Ok(session.id)
}

/// The practice of a project, Biology, with one session about cells.
fn cells(db: &Database, dir: &Path) -> Result<PracticeId> {
    let (project, _) = session(db, dir, "Biology", "Mitochondria power the cell.")?;
    db.project_practice(project)
}

/// A `kind` of question asking `question`, whose gist is "Gist: `question`".
fn written(kind: QuestionKind, question: &str) -> WrittenQuestion {
    WrittenQuestion {
        gist: format!("Gist: {question}"),
        body: body(kind, question),
    }
}

fn body(kind: QuestionKind, question: &str) -> PracticeBody {
    match kind {
        QuestionKind::Choice => PracticeBody::Choice {
            question: question.to_owned(),
            choices: vec!["Mitochondria".into(), "Ribosomes".into(), "Nucleus".into()],
            answer: 0,
            explanation: "They make ATP [1].".into(),
            cites: vec![1],
        },
        QuestionKind::Open => PracticeBody::Open {
            question: question.to_owned(),
            reference: "They make ATP from sugar.".into(),
            cites: vec![1],
        },
    }
}

/// Writes the first unwritten question of `practice`, asking `question`, and returns it.
fn write_next(db: &Database, practice: PracticeId, question: &str) -> Result<QuestionId> {
    let next = db
        .practice(practice)?
        .unwrap()
        .questions
        .into_iter()
        .find(|q| q.status == QuestionStatus::Pending)
        .expect("a question waits to be written");
    assert!(db.begin_question(next.id)?);
    assert!(db.finish_question(next.id, &written(next.kind, question), &[])?);
    Ok(next.id)
}

/// The statuses of `practice`'s questions, in order.
fn statuses(db: &Database, practice: PracticeId) -> Result<Vec<(QuestionKind, QuestionStatus)>> {
    Ok(db
        .practice(practice)?
        .unwrap()
        .questions
        .iter()
        .map(|question| (question.kind, question.status))
        .collect())
}

#[test]
fn a_practice_starts_with_two_questions_written_after_the_reads_one_at_a_time() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;

    let started = db.practice(practice)?.unwrap();
    assert_eq!(started.questions.len(), AHEAD as usize);
    let first = &started.questions[0];
    let second = &started.questions[1];
    let first_job = first.job.clone().unwrap();
    assert_eq!(
        (first_job.kind, first_job.target, first_job.status),
        (
            JobKind::Question,
            JobTarget::Question(first.id),
            JobStatus::Blocked
        ),
        "it waits for the session's file to be read"
    );
    let read = db.claim_job(&[JobKind::Extract])?.unwrap();
    db.succeed_job(read.id, &[])?;
    assert_eq!(
        db.claim_job(&[JobKind::Question])?.map(|job| job.target),
        Some(JobTarget::Question(first.id)),
    );
    assert_eq!(
        db.claim_job(&[JobKind::Question])?,
        None,
        "the second waits for the first, to know what it asked"
    );
    assert_eq!(
        second.job.as_ref().map(|job| job.status),
        Some(JobStatus::Blocked)
    );

    let material = db.practice_material(practice)?.unwrap();
    assert_eq!(material.sources.len(), 1);
    assert_eq!(material.notes, "Mitochondria power the cell.");
    Ok(())
}

#[test]
fn a_project_has_one_practice_and_it_needs_the_project() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (project, _) = session(&db, dir.path(), "Biology", "Cells")?;
    let practice = db.project_practice(project)?;
    assert_eq!(db.project_practice(project)?, practice, "get or create");
    assert_eq!(db.practices()?.len(), 1);
    let error = db.project_practice(ProjectId::new(9_999)).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::NotFound);
    assert_eq!(db.practices()?.len(), 1, "nothing half-made");
    Ok(())
}

#[test]
fn material_comes_from_every_session_with_the_notes_but_not_the_mentions() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (project, _) = session(&db, dir.path(), "Biology", "Cells divide.")?;
    session_in(&db, dir.path(), project, "@study When did Rome fall?")?;
    let practice = db.project_practice(project)?;

    let material = db.practice_material(practice)?.unwrap();
    assert_eq!(material.sources.len(), 2);
    assert_eq!(material.notes, "Cells divide.\nWhen did Rome fall?");
    Ok(())
}

#[test]
fn a_file_refiled_to_another_project_feeds_that_project_only() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (a, _) = session(&db, dir.path(), "Biology", "Cells divide.")?;
    let (b, _) = session(&db, dir.path(), "History", "Rome fell.")?;
    let (practice_a, practice_b) = (db.project_practice(a)?, db.project_practice(b)?);
    let moved = db.project_material(a)?.sources[0];
    assert!(db.set_source_project(moved, Some(b))?);

    assert!(
        db.practice_material(practice_a)?
            .unwrap()
            .sources
            .is_empty()
    );
    assert!(
        db.practice_material(practice_b)?
            .unwrap()
            .sources
            .contains(&moved)
    );
    assert_eq!(db.practice_material(PracticeId::new(9_999))?, None, "gone");
    Ok(())
}

#[test]
fn questions_draw_from_a_session_added_after_the_practice_began() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (project, _) = session(&db, dir.path(), "Biology", "Cells divide.")?;
    let practice = db.project_practice(project)?;
    assert_eq!(db.practice_material(practice)?.unwrap().sources.len(), 1);

    session_in(&db, dir.path(), project, "Rome fell in 476.")?;
    let material = db.practice_material(practice)?.unwrap();
    assert_eq!(material.sources.len(), 2);
    assert_eq!(material.notes, "Cells divide.\nRome fell in 476.");
    Ok(())
}

#[test]
fn a_written_question_is_checked_and_stored_once_with_its_citations() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = db.practice(practice)?.unwrap().questions[0].id;
    assert!(db.begin_question(first)?);

    let open = written(QuestionKind::Open, "Why?");
    let error = db.finish_question(first, &open, &[]).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput, "the other kind");
    let one_choice = WrittenQuestion {
        body: PracticeBody::Choice {
            question: "Which?".into(),
            choices: vec!["Only one".into()],
            answer: 0,
            explanation: String::new(),
            cites: Vec::new(),
        },
        ..written(QuestionKind::Choice, "Which?")
    };
    assert!(db.finish_question(first, &one_choice, &[]).is_err());
    let no_gist = WrittenQuestion {
        gist: " ".into(),
        ..written(QuestionKind::Choice, "Which?")
    };
    assert!(db.finish_question(first, &no_gist, &[]).is_err());

    let citation = Citation {
        marker: 1,
        source_id: None,
        source_name: "cells.txt".into(),
        anchor: Anchor::Page { page: 1 },
        quote: "Mitochondria make ATP.".into(),
    };
    let asked = written(QuestionKind::Choice, "What powers the cell?");
    assert!(db.finish_question(first, &asked, std::slice::from_ref(&citation))?);
    let question = db.question(first)?.unwrap();
    assert_eq!(question.status, QuestionStatus::Ready);
    assert_eq!(question.written, Some(asked.clone()));
    assert_eq!(question.citations, [citation]);

    assert!(!db.begin_question(first)?, "already written");
    assert!(!db.finish_question(first, &asked, &[])?, "kept as it is");
    assert_eq!(
        db.asked_questions(practice, 40)?,
        ["Gist: What powers the cell?"],
        "the short form only"
    );
    Ok(())
}

#[test]
fn a_choice_is_graded_at_once_and_the_next_question_is_queued() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = write_next(&db, practice, "What powers the cell?")?;

    for wrong in [
        PracticeAnswer::Choice(3),
        PracticeAnswer::Open("Mitochondria".into()),
    ] {
        let error = db.answer_question(first, &wrong).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput, "{wrong:?}");
    }
    let pending = db.practice(practice)?.unwrap().questions[1].id;
    let error = db
        .answer_question(pending, &PracticeAnswer::Choice(0))
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput, "not written yet");

    assert_eq!(
        db.answer_question(first, &PracticeAnswer::Choice(1))?,
        Answered::Graded(Verdict::Incorrect)
    );
    let answered = db.question(first)?.unwrap();
    assert_eq!(answered.answer, Some(PracticeAnswer::Choice(1)));
    assert_eq!(answered.verdict, Some(Verdict::Incorrect));
    assert!(answered.answered_at.is_some() && answered.graded_at.is_some());
    assert!(
        db.answer_question(first, &PracticeAnswer::Choice(0))
            .is_err()
    );

    use QuestionKind::{Choice, Open};
    use QuestionStatus::{Graded, Pending};
    assert_eq!(
        statuses(&db, practice)?,
        [(Choice, Graded), (Choice, Pending), (Open, Pending)],
        "two questions wait again, the third one open"
    );
    let score = db.practice(practice)?.unwrap().score;
    assert_eq!(
        score,
        PracticeScore {
            asked: 1,
            answered: 1,
            correct: 0,
            partly: 0,
            incorrect: 1,
        }
    );
    Ok(())
}

#[test]
fn an_open_answer_waits_for_the_grade_a_model_gives() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    for question in ["One?", "Two?"] {
        let id = write_next(&db, practice, question)?;
        db.answer_question(id, &PracticeAnswer::Choice(0))?;
    }
    let open = write_next(&db, practice, "Why do cells need mitochondria?")?;
    assert_eq!(db.question(open)?.unwrap().kind, QuestionKind::Open);
    assert!(!db.begin_grade(open)?, "nothing to grade yet");

    let error = db
        .answer_question(open, &PracticeAnswer::Open("  ".into()))
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput);
    let Answered::Grading(job) =
        db.answer_question(open, &PracticeAnswer::Open(" For energy. ".into()))?
    else {
        panic!("an open answer is graded by a model");
    };
    let job = db.job(job)?.unwrap();
    assert_eq!(
        (job.kind, job.target, job.status),
        (JobKind::Grade, JobTarget::Question(open), JobStatus::Queued)
    );
    let answered = db.question(open)?.unwrap();
    assert_eq!(answered.status, QuestionStatus::Answered);
    assert_eq!(
        answered.answer,
        Some(PracticeAnswer::Open("For energy.".into()))
    );
    assert_eq!(answered.job.map(|job| job.kind), Some(JobKind::Grade));

    assert!(db.begin_grade(open)?);
    assert!(db.finish_grade(open, Verdict::Partly, "Right, but say how: ATP.")?);
    assert!(
        !db.finish_grade(open, Verdict::Correct, "Again")?,
        "graded once"
    );
    let graded = db.question(open)?.unwrap();
    assert_eq!(graded.status, QuestionStatus::Graded);
    assert_eq!(graded.verdict, Some(Verdict::Partly));
    assert_eq!(graded.feedback.as_deref(), Some("Right, but say how: ATP."));

    let score = db.practice(practice)?.unwrap().score;
    assert_eq!((score.answered, score.correct, score.partly), (3, 2, 1));
    assert_eq!(
        db.asked_questions(practice, 2)?,
        ["Gist: Two?", "Gist: Why do cells need mitochondria?"],
        "the latest, oldest first"
    );
    Ok(())
}

#[test]
fn practices_are_listed_by_latest_answer_and_deleted_with_their_questions() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let older = cells(&db, dir.path())?;
    let (history, rome) = session(&db, dir.path(), "History", "Rome fell in 476.")?;
    let newer = db.project_practice(history)?;
    let order = |db: &Database| -> Result<Vec<PracticeId>> {
        Ok(db.practices()?.iter().map(|practice| practice.id).collect())
    };
    assert_eq!(order(&db)?, [newer, older]);

    let first = write_next(&db, older, "What powers the cell?")?;
    db.connection
        .execute("UPDATE practices SET updated_at = 0", [])?;
    db.answer_question(first, &PracticeAnswer::Choice(0))?;
    let listed = db.practices()?;
    assert_eq!(order(&db)?, [older, newer], "answered last, listed first");
    assert_eq!(listed[0].score.correct, 1);

    db.delete_session(rome)?;
    assert!(db.practice(newer)?.is_some(), "kept");

    assert!(db.delete_practice(older)?);
    assert!(!db.delete_practice(older)?);
    assert_eq!(db.practice(older)?, None);
    assert_eq!(db.question(first)?, None);
    assert!(db.jobs_for(JobTarget::Question(first))?.is_empty());
    Ok(())
}

/// The SQL list of unanswered statuses says the same as [`QuestionStatus::is_unanswered`].
#[test]
fn the_unanswered_list_matches_the_status_enum() {
    let codes: Vec<String> = QuestionStatus::ALL
        .iter()
        .filter(|status| status.is_unanswered())
        .map(|status| format!("'{}'", status.code()))
        .collect();
    assert_eq!(UNANSWERED, format!("({})", codes.join(", ")));
}

#[test]
fn a_question_becomes_a_card_in_its_practice_set_of_mistakes() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = write_next(&db, practice, "What powers the cell?")?;
    let second = write_next(&db, practice, "Where is ATP made?")?;

    let set = db
        .add_question_card(first, "Mistakes: Cells")?
        .expect("the set");
    // Twice is once; another question joins the same set.
    assert_eq!(db.add_question_card(first, "ignored")?, Some(set));
    assert_eq!(db.add_question_card(second, "ignored")?, Some(set));

    let artifact = db.artifact(set)?.unwrap();
    assert_eq!(artifact.title, "Mistakes: Cells");
    let cards = db.cards_of(set)?;
    let sides: Vec<(&str, &str)> = cards
        .iter()
        .map(|card| (card.front.as_str(), card.back.as_str()))
        .collect();
    assert_eq!(
        sides,
        [
            (
                "What powers the cell?",
                "Mitochondria\n\nThey make ATP [1]."
            ),
            ("Where is ATP made?", "Mitochondria\n\nThey make ATP [1]."),
        ]
    );
    // The set outlives its practice.
    db.delete_practice(practice)?;
    assert!(db.artifact(set)?.is_some());
    Ok(())
}

#[test]
fn a_set_of_mistakes_needs_a_title() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = write_next(&db, practice, "What powers the cell?")?;

    let error = db.add_question_card(first, "  ").unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput);
    assert!(
        db.add_question_card(first, "Mistakes: Cells")?.is_some(),
        "nothing half-made"
    );
    Ok(())
}

#[test]
fn a_set_of_mistakes_from_a_long_practice_title_is_cut_to_fit() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = write_next(&db, practice, "What powers the cell?")?;

    let title = format!("Mistakes: {}", "é".repeat(195));
    let set = db.add_question_card(first, &title)?.expect("the set");
    let stored = db.artifact(set)?.unwrap().title;
    assert_eq!(stored.chars().count(), 200);
    assert!(title.starts_with(&stored));
    Ok(())
}

#[test]
fn a_set_of_mistakes_stays_outside_the_projects_material() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = write_next(&db, practice, "What powers the cell?")?;
    let second = write_next(&db, practice, "Where is ATP made?")?;
    let set = db
        .add_question_card(first, "Mistakes: Cells")?
        .expect("the set");

    let artifact = db.artifact(set)?.unwrap();
    assert_eq!(artifact.practice_id, Some(practice));
    assert!(artifact.mistakes);
    assert!(
        db.material_changes(set, &[])?.is_none(),
        "not a piece of the flashcards"
    );
    assert_eq!(db.cards_of(set)?.len(), 1, "its cards stay");
    assert_eq!(db.add_question_card(second, "ignored")?, Some(set));

    // Once its practice is gone the set stays, with its cards.
    db.delete_practice(practice)?;
    let kept = db.artifact(set)?.unwrap();
    assert_eq!((kept.practice_id, kept.mistakes), (None, true));
    assert_eq!(db.cards_of(set)?.len(), 2);
    Ok(())
}

#[test]
fn an_unfinished_set_of_mistakes_takes_no_cards() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let practice = cells(&db, dir.path())?;
    let first = write_next(&db, practice, "What powers the cell?")?;
    let second = write_next(&db, practice, "Where is ATP made?")?;
    let set = db
        .add_question_card(first, "Mistakes: Cells")?
        .expect("the set");
    db.connection.execute(
        "UPDATE artifacts SET status = 'pending', body = NULL WHERE id = ?1",
        rusqlite::params![set],
    )?;

    assert_eq!(db.add_question_card(second, "ignored")?, None);
    Ok(())
}

#[test]
fn material_follows_the_order_files_were_attached_in_across_sessions() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (project, _) = session(&db, dir.path(), "Biology", "Cells divide.")?;
    session_in(&db, dir.path(), project, "Rome fell.")?;

    let held = db.project_material(project)?;
    assert_eq!(held.notes, "Cells divide.\nRome fell.");
    assert_eq!(
        held,
        db.practice_material(db.project_practice(project)?)?
            .unwrap()
    );
    Ok(())
}
