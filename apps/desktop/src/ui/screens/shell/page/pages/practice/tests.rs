//! The Quiz page, end to end: loading, opening a project's quiz, answering a choice
//! or in the student's own words, and the results it leaves.

use super::ids;
use super::page::{PracticeRead, current_question};
use crate::app::preferences::Preferences;
use crate::testing::TempApp;
use crate::ui::screens::shell::page::testing::{
    click, find, open_offline_shell, open_shell, render, wait_until, without_workers,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::{AppContext as _, Entity, TestAppContext};
use study_app::views::{
    JobKind, JobStatus, MessageRole, PracticeAnswer, PracticeBody, QuestionKind, QuestionStatus,
    Verdict, WrittenQuestion,
};
use study_core::db::{Database, NewPart};
use study_core::{PracticeId, QuestionId};

/// The rail button for the Quiz page.
const PRACTICE_RAIL: usize = Page::Practice as usize;

/// A choice question asking `question`, whose first choice is right.
fn choice(question: &str) -> WrittenQuestion {
    WrittenQuestion {
        gist: format!("Gist: {question}"),
        body: PracticeBody::Choice {
            question: question.to_owned(),
            choices: vec!["Mitochondria".into(), "Ribosomes".into(), "Nucleus".into()],
            answer: 0,
            explanation: "They make ATP.".into(),
            cites: Vec::new(),
        },
    }
}

/// An open question asking `question`.
fn open(question: &str) -> WrittenQuestion {
    WrittenQuestion {
        gist: format!("Gist: {question}"),
        body: PracticeBody::Open {
            question: question.to_owned(),
            reference: "They make the ATP the cell runs on.".into(),
            cites: Vec::new(),
        },
    }
}

/// Writes the next question of the practice as its writer would, a choice asking
/// `question`, and returns it.
fn write_next(database: &Database, question: &str) -> QuestionId {
    write_next_as(database, &choice(question))
}

/// Writes the next question of the practice as `written`, and returns it.
fn write_next_as(database: &Database, written: &WrittenQuestion) -> QuestionId {
    let job = database.claim_job(&[JobKind::Question]).unwrap().unwrap();
    let id = job.target.question().unwrap();
    assert!(database.begin_question(id).unwrap());
    assert!(database.finish_question(id, written, &[]).unwrap());
    database.succeed_job(job.id, &[]).unwrap();
    id
}

/// Reads the Quiz page's state again, as a job event would make it.
fn reload(cx: &mut TestAppContext, shell: &Entity<AppShell>) {
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_practice(cx)));
}

#[test]
fn a_load_opens_the_chosen_quiz_or_else_the_latest_and_lists_every_project()
-> study_core::Result<()> {
    let app = TempApp::new();
    let empty = PracticeRead::read(&app, None)?;
    assert!(empty.practices.is_empty() && empty.open.is_none());
    assert!(empty.projects.is_empty());

    let biology = app.create_project("Biology")?;
    let history = app.create_project("History")?;
    let database = app.database();
    let first = database.project_practice(biology.id)?;
    let second = database.project_practice(history.id)?;

    let chosen = PracticeRead::read(&app, Some(first))?;
    assert_eq!(chosen.open, Some(first));
    assert_eq!(chosen.practice.map(|practice| practice.id), Some(first));
    assert_eq!(chosen.projects.len(), 2, "every project can be quizzed");

    database.delete_practice(first)?;
    let fallback = PracticeRead::read(&app, Some(first))?;
    assert_eq!(fallback.open, Some(second));
    Ok(())
}

#[gpui_kit::test]
fn a_project_starts_its_quiz_and_says_why_it_cannot_write(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.create_project("Biology").unwrap();
    for (title, note) in [
        ("Cells", "Mitochondria power the cell."),
        ("Mitosis", "Prophase comes first."),
    ] {
        let session = app.create_session(project.id, title).unwrap();
        app.database()
            .post_message(
                session.id,
                MessageRole::User,
                &[NewPart::Text(note.into())],
                &|_, _| true,
            )
            .unwrap();
    }
    let (window, shell) = open_offline_shell(cx, &app, true);

    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.projects.len() == 1)
    });
    assert!(app.practices().unwrap().is_empty());

    // Choosing the project starts its one quiz, over all its sessions.
    click(cx, window, (ids::PROJECT, project.id.get() as u64));
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    let practice = cx.update(|cx| shell.read(cx).practice.practice.clone().unwrap());
    assert_eq!(practice.project_id, project.id);
    assert_eq!(
        cx.update(|cx| shell.read(cx).practice.practices.len()),
        1,
        "the sidebar lists it"
    );

    // Nobody signed in to ChatGPT, so writing waits for setup and says where to fix it.
    wait_until(cx, |cx| {
        reload(cx, &shell);
        cx.update(|cx| {
            let state = &shell.read(cx).practice;
            state
                .current_question()
                .and_then(|question| question.job.as_ref())
                .is_some_and(|job| {
                    job.status == JobStatus::Waiting
                        && job.waiting_for == Some(study_core::Requirement::LanguageModels)
                })
        })
    });
    let job_id = cx.update(|cx| {
        shell
            .read(cx)
            .practice
            .current_question()
            .unwrap()
            .job
            .as_ref()
            .unwrap()
            .id
            .get() as u64
    });
    assert!(find(cx, window, (ids::RETRY_JOB, job_id)).is_none());
    assert!(find(cx, window, (ids::SETTINGS, job_id)).is_some());
}

#[gpui_kit::test]
fn a_choice_is_graded_at_once_and_joins_the_results(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let practice: PracticeId = database.project_practice(project.id).unwrap();
    let first = write_next(&database, "What powers the cell?");
    let second = write_next(&database, "Where is ATP made?");

    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    let on_screen = cx.update(|cx| shell.read(cx).practice.current_question().map(|q| q.id));
    assert_eq!(on_screen, Some(first));
    assert!(find(cx, window, (ids::RESULT, 1u64)).is_none());
    let choice_label = |cx: &mut TestAppContext, index: u64| {
        find(cx, window, (ids::CHOICE, index)).and_then(|choice| choice.label().map(str::to_owned))
    };
    assert_eq!(choice_label(cx, 0).as_deref(), Some("A. Mitochondria"));
    assert_eq!(choice_label(cx, 2).as_deref(), Some("C. Nucleus"));

    // The first choice is the right one.
    click(cx, window, (ids::CHOICE, 0u64));
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).practice;
            !state.busy
                && state
                    .current_question()
                    .is_some_and(|question| question.status == QuestionStatus::Graded)
        })
    });
    let (verdict, correct, current) = cx.update(|cx| {
        let state = &shell.read(cx).practice;
        let question = state.current_question().unwrap();
        (
            question.verdict,
            state.practice.as_ref().unwrap().score.correct,
            question.id,
        )
    });
    assert_eq!(verdict, Some(Verdict::Correct));
    assert_eq!(correct, 1);
    // Once graded, the pick reads as pressed, the right choice and a wrong pick say so, and
    // the verdict is named with why.
    let checked = |cx: &mut TestAppContext, index: u64| {
        find(cx, window, (ids::CHOICE, index)).and_then(|choice| choice.checked())
    };
    assert_eq!(
        choice_label(cx, 0).as_deref(),
        Some("A. Mitochondria · correct")
    );
    assert_eq!(choice_label(cx, 1).as_deref(), Some("B. Ribosomes"));
    assert_eq!(checked(cx, 0), Some(true));
    assert_eq!(checked(cx, 1), Some(false));
    assert_eq!(
        find(cx, window, ids::VERDICT).and_then(|verdict| verdict.label().map(str::to_owned)),
        Some("Correct · They make ATP.".to_owned())
    );
    assert_eq!(
        current, first,
        "the verdict stays on screen until the student moves on"
    );

    click(cx, window, ids::NEXT);
    let next = cx.update(|cx| {
        let state = &shell.read(cx).practice;
        current_question(state.practice.as_ref().unwrap(), state.current).map(|q| (q.id, q.kind))
    });
    assert_eq!(next, Some((second, QuestionKind::Choice)));
    // The next question's choices go by the same ids, so an agent finds them the same way.
    assert_eq!(choice_label(cx, 1).as_deref(), Some("B. Ribosomes"));

    // What was answered is kept below, named by its number and gist, and opens to show how
    // it went.
    let result = (ids::RESULT, 1u64);
    assert_eq!(
        find(cx, window, result).and_then(|row| row.label().map(str::to_owned)),
        Some("Question 1 · Gist: What powers the cell?".to_owned())
    );
    click(cx, window, result);
    assert!(cx.update(|cx| shell.read(cx).practice.expanded.contains(&first)));
    assert_eq!(
        database.practice(practice).unwrap().unwrap().score.answered,
        1
    );
}

#[gpui_kit::test]
fn a_quiz_needs_background_work_to_be_answered(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    let first = write_next(&database, "What powers the cell?");

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    click(cx, window, (ids::CHOICE, 0u64));
    let error = cx.update(|cx| shell.read(cx).practice.error);
    assert_eq!(error, Some(Message::WorkspaceUnavailable));
    let status = database.question(first).unwrap().unwrap().status;
    assert_eq!(status, QuestionStatus::Ready, "nothing was stored");
}

#[gpui_kit::test]
fn an_open_answer_is_sent_checked_and_shown_with_its_feedback(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    // One question in three is open: the third, once the first two are answered.
    for question in ["What powers the cell?", "Where is ATP made?"] {
        let id = write_next(&database, question);
        database
            .answer_question(id, &PracticeAnswer::Choice(0))
            .unwrap();
    }
    let open_id = write_next_as(&database, &open("Why do cells need mitochondria?"));
    assert_eq!(
        database.question(open_id).unwrap().unwrap().kind,
        QuestionKind::Open
    );

    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| {
            shell
                .read(cx)
                .practice
                .current_question()
                .is_some_and(|question| question.id == open_id)
        })
    });
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.practice.answer.update(cx, |input, cx| {
                input.set_value("For energy.".to_owned(), window, cx)
            });
        });
    })
    .unwrap();
    click(cx, window, ids::SUBMIT);

    // Stored at once; nobody is signed in, so grading waits and says where to fix it.
    wait_until(cx, |cx| {
        reload(cx, &shell);
        cx.update(|cx| {
            shell
                .read(cx)
                .practice
                .current_question()
                .and_then(|question| question.job.as_ref())
                .is_some_and(|job| {
                    job.kind == JobKind::Grade
                        && job.status == JobStatus::Waiting
                        && job.waiting_for == Some(study_core::Requirement::LanguageModels)
                })
        })
    });
    let stored = database.question(open_id).unwrap().unwrap();
    assert_eq!(stored.status, QuestionStatus::Answered);
    assert_eq!(
        stored.answer,
        Some(PracticeAnswer::Open("For energy.".into()))
    );
    let job_id = cx.update(|cx| {
        shell
            .read(cx)
            .practice
            .current_question()
            .unwrap()
            .job
            .as_ref()
            .unwrap()
            .id
            .get() as u64
    });
    assert!(find(cx, window, (ids::RETRY_JOB, job_id)).is_none());
    assert!(find(cx, window, (ids::SETTINGS, job_id)).is_some());

    // Once a model grades it, the verdict and why show in its place.
    assert!(
        database
            .finish_grade(
                open_id,
                Verdict::Partly,
                "Right, but say how: they make ATP."
            )
            .unwrap()
    );
    wait_until(cx, |cx| {
        reload(cx, &shell);
        cx.update(|cx| {
            shell
                .read(cx)
                .practice
                .current_question()
                .is_some_and(|question| question.verdict == Some(Verdict::Partly))
        })
    });
    // Grading's problem is gone. A retry left by Next is the question ahead's, which
    // nobody signed in can write either, and shows exactly when that one failed.
    let ahead = cx.update(|cx| {
        let practice = shell.read(cx).practice.practice.clone().unwrap();
        practice
            .questions
            .iter()
            .find(|question| question.status.is_unanswered())
            .and_then(|question| question.job.as_ref())
            .cloned()
    });
    if let Some(ahead) = ahead {
        assert_eq!(
            find(cx, window, (ids::RETRY_JOB, ahead.id.get() as u64)).is_some(),
            ahead.status.is_stopped()
        );
    }
    assert!(find(cx, window, (ids::RETRY_JOB, job_id)).is_none());
    assert!(find(cx, window, (ids::SETTINGS, job_id)).is_none());
    assert!(find(cx, window, ids::NEXT).is_some());
    assert_eq!(
        find(cx, window, ids::VERDICT).and_then(|verdict| verdict.label().map(str::to_owned)),
        Some("Partly correct · Right, but say how: they make ATP.".to_owned())
    );
}

/// A choice question takes the keyboard as it comes on screen: a letter answers it, and
/// Enter goes on to the next question.
#[gpui_kit::test]
fn a_choice_is_answered_and_left_with_the_keyboard(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    let first = write_next(&database, "What powers the cell?");
    let second = write_next(&database, "Where is ATP made?");

    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    render(cx, window);

    // B is Ribosomes, the wrong one; a letter past the choices does nothing.
    cx.simulate_keystrokes(window, "z");
    assert_eq!(
        database.question(first).unwrap().unwrap().status,
        QuestionStatus::Ready
    );
    cx.simulate_keystrokes(window, "b");
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).practice;
            !state.busy
                && state
                    .current_question()
                    .is_some_and(|question| question.status == QuestionStatus::Graded)
        })
    });
    let answer = database.question(first).unwrap().unwrap().answer;
    assert_eq!(answer, Some(PracticeAnswer::Choice(1)));

    render(cx, window);
    cx.simulate_keystrokes(window, "enter");
    let on_screen = cx.update(|cx| shell.read(cx).practice.current_question().map(|q| q.id));
    assert_eq!(on_screen, Some(second));
}

/// Deleting a quiz asks first, since every answer goes with it.
#[gpui_kit::test]
fn deleting_a_practice_asks_first(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let practice = database.project_practice(project.id).unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    click(cx, window, ids::DELETE);
    assert!(database.practice(practice).unwrap().is_some(), "only asked");
    click(cx, window, ids::CONFIRM_DELETE);
    wait_until(cx, |_| database.practice(practice).unwrap().is_none());
}

/// A question answered wrong can become a flashcard in the practice's set of mistakes.
#[gpui_kit::test]
fn a_missed_question_is_added_to_the_flashcards(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    write_next(&database, "What powers the cell?");

    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    // Ribosomes: wrong.
    click(cx, window, (ids::CHOICE, 1u64));
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).practice;
            !state.busy
                && state
                    .current_question()
                    .is_some_and(|question| question.verdict == Some(Verdict::Incorrect))
        })
    });
    // The wrong pick reads as pressed and incorrect, beside the right one, and the verdict
    // says so with why.
    let choice = |cx: &mut TestAppContext, index: u64| {
        let choice = find(cx, window, (ids::CHOICE, index)).unwrap();
        (choice.label().map(str::to_owned), choice.checked())
    };
    assert_eq!(
        choice(cx, 1),
        (Some("B. Ribosomes · incorrect".to_owned()), Some(true))
    );
    assert_eq!(
        choice(cx, 0),
        (Some("A. Mitochondria · correct".to_owned()), Some(false))
    );
    assert_eq!(choice(cx, 2), (Some("C. Nucleus".to_owned()), Some(false)));
    assert_eq!(
        find(cx, window, ids::VERDICT).and_then(|verdict| verdict.label().map(str::to_owned)),
        Some("Not quite · They make ATP.".to_owned())
    );
    click(cx, window, ids::ADD_CARD);
    wait_until(cx, |_| {
        app.material(project.id).unwrap().iter().any(|piece| {
            piece
                .current
                .as_ref()
                .is_some_and(|set| set.practice_id.is_some())
        })
    });
    let set = app.material(project.id).unwrap()[0]
        .current
        .as_ref()
        .unwrap()
        .id;
    let cards = database.cards_of(set).unwrap();
    assert_eq!(cards[0].front, "What powers the cell?");
    assert!(cards[0].back.starts_with("Mitochondria"));
}

/// A deletion asked for one quiz is not left waiting on the next one opened.
#[gpui_kit::test]
fn opening_another_quiz_drops_a_pending_deletion(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    let history = database.create_project("History").unwrap();
    database.project_practice(history.id).unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    click(cx, window, ids::DELETE);
    assert!(cx.update(|cx| shell.read(cx).practice.confirm_delete));
    click(cx, window, (ids::PROJECT, project.id.get() as u64));
    assert!(!cx.update(|cx| shell.read(cx).practice.confirm_delete));
    assert!(find(cx, window, ids::CONFIRM_DELETE).is_none());
}

/// An answer half written for one quiz is not left in the box when another opens.
#[gpui_kit::test]
fn opening_another_quiz_clears_a_half_written_answer(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    let history = database.create_project("History").unwrap();
    let second = database.project_practice(history.id).unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.open == Some(second))
    });
    render(cx, window);
    let answer = |cx: &mut TestAppContext| {
        cx.update(|cx| shell.read(cx).practice.answer.read(cx).value().to_string())
    };
    cx.update_window(window, |_, window, cx| {
        let input = shell.read(cx).practice.answer.clone();
        input.update(cx, |input, cx| input.set_value("They make ATP", window, cx));
    })
    .unwrap();

    click(cx, window, (ids::PROJECT, project.id.get() as u64));
    render(cx, window);
    assert_eq!(answer(cx), "");
}

/// A failure that comes back after the student opened another quiz stays with the quiz it
/// was for, and one for the quiz still showing is shown.
#[gpui_kit::test]
fn a_late_failure_is_not_shown_on_another_quiz(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let first = database.project_practice(project.id).unwrap();
    let history = database.create_project("History").unwrap();
    let second = database.project_practice(history.id).unwrap();
    // A question not written yet cannot become a flashcard, so adding it fails.
    let job = database.claim_job(&[JobKind::Question]).unwrap().unwrap();
    let unwritten = job.target.question().unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.open == Some(second))
    });

    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.add_to_flashcards(unwritten, cx);
            shell.choose_practice(first, cx);
        })
    });
    cx.run_until_parked();
    assert_eq!(cx.update(|cx| shell.read(cx).practice.error), None);

    cx.update(|cx| shell.update(cx, |shell, cx| shell.add_to_flashcards(unwritten, cx)));
    cx.run_until_parked();
    assert_eq!(
        cx.update(|cx| shell.read(cx).practice.error),
        Some(Message::ActionError)
    );
}

/// When the question ahead could not be written, the answered question on screen says so
/// by its Next button, and Next leads to the same problem rather than a blank.
#[gpui_kit::test]
fn a_question_ahead_that_failed_shows_under_the_answered_one(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    database.project_practice(project.id).unwrap();
    let first = write_next(&database, "What powers the cell?");
    database
        .answer_question(first, &PracticeAnswer::Choice(0))
        .unwrap();
    let ahead = database.claim_job(&[JobKind::Question]).unwrap().unwrap();
    let failure = study_core::Failure::new(study_core::ErrorKind::Internal, "the writer broke");
    assert!(database.fail_job(ahead.id, &failure, None).unwrap());

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, PRACTICE_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).practice.practice.is_some())
    });
    cx.update(|cx| shell.update(cx, |shell, _| shell.practice.current = Some(first)));
    render(cx, window);
    assert!(find(cx, window, ids::NEXT).is_some());
    assert!(
        find(cx, window, (ids::RETRY_JOB, ahead.id.get() as u64)).is_some(),
        "the failure ahead shows by Next"
    );

    click(cx, window, ids::NEXT);
    assert!(
        find(cx, window, (ids::RETRY_JOB, ahead.id.get() as u64)).is_some(),
        "and after Next"
    );
}
