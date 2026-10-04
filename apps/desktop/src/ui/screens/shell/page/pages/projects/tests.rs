//! The Projects page, end to end: creating, renaming and deleting, and exam days.

use super::*;
use crate::app::preferences::Preferences;
use crate::testing::TempApp;
use crate::ui::screens::shell::page::testing::{
    click, find, open_shell, render, wait_until, without_workers,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::input::InputState;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, Entity, TestAppContext};
use study_core::Day;

#[gpui_kit::test]
fn project_flow_persists_create_rename_and_delete(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());

    click(cx, window, Page::Projects as usize);
    click(cx, window, ids::SIDEBAR_NEW);
    // A blank name is refused before anything is saved.
    click(cx, window, ids::SAVE);
    assert_eq!(
        cx.update(|cx| shell.read(cx).projects.create_error),
        Some(Message::ProjectNameError)
    );
    assert!(app.projects().unwrap().is_empty());
    let original = text(Locale::English, Message::ProjectName);
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.projects.create_input.update(cx, |input, cx| {
                input.set_value(original, window, cx);
            });
        });
    })
    .unwrap();
    click(cx, window, ids::SAVE);
    assert_eq!(app.projects().unwrap()[0].name, original);
    assert_eq!(sidebar_names(cx, &shell), [original]);

    click(cx, window, ids::RENAME);
    let renamed = text(Locale::English, Message::Projects);
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.projects.name_input.update(cx, |input, cx| {
                input.set_value(renamed, window, cx);
            });
        });
    })
    .unwrap();
    click(cx, window, ids::SAVE);
    assert_eq!(app.projects().unwrap()[0].name, renamed);
    assert_eq!(sidebar_names(cx, &shell), [renamed]);

    click(cx, window, ids::DELETE);
    click(cx, window, ids::CONFIRM_DELETE);
    assert!(app.projects().unwrap().is_empty());
    assert!(sidebar_names(cx, &shell).is_empty());
}

#[gpui_kit::test]
fn create_dialog_over_rename_creates_and_leaves_the_rename_alone(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    let original = text(Locale::English, Message::ProjectName);
    let typed = text(Locale::English, Message::Projects);
    let created = text(Locale::English, Message::NewProject);
    let set = |cx: &mut TestAppContext, pick: fn(&ProjectsState) -> &Entity<InputState>, value| {
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| {
                pick(&shell.projects).update(cx, |input, cx| input.set_value(value, window, cx));
            });
        })
        .unwrap();
    };

    click(cx, window, Page::Projects as usize);
    click(cx, window, ids::SIDEBAR_NEW);
    set(cx, |projects| &projects.create_input, original);
    click(cx, window, ids::SAVE);
    click(cx, window, ids::RENAME);
    set(cx, |projects| &projects.name_input, typed);
    // A failed name in the rename page stays out of the dialog.
    cx.update(|cx| {
        shell.update(cx, |shell, _| {
            shell.projects.error = Some(Message::ProjectsSaveError)
        })
    });

    click(cx, window, ids::SIDEBAR_NEW);
    assert_eq!(cx.update(|cx| shell.read(cx).projects.create_error), None);
    set(cx, |projects| &projects.create_input, created);
    cx.update_window(window, |_, window, cx| window.press("enter", cx))
        .unwrap();
    cx.run_until_parked();

    let mut names: Vec<_> = app
        .projects()
        .unwrap()
        .into_iter()
        .map(|project| project.name)
        .collect();
    names.sort();
    let mut expected = vec![original.to_owned(), created.to_owned()];
    expected.sort();
    assert_eq!(names, expected);
    // What was typed into the rename page is still there.
    let rename_value = cx.update(|cx| {
        shell
            .read(cx)
            .projects
            .name_input
            .read(cx)
            .value()
            .to_string()
    });
    assert_eq!(rename_value, typed);
}

/// The projects the sidebar lists, by name.
fn sidebar_names(cx: &mut TestAppContext, shell: &Entity<AppShell>) -> Vec<String> {
    cx.update(|cx| {
        shell
            .read(cx)
            .sessions
            .projects
            .iter()
            .map(|project| project.name.clone())
            .collect()
    })
}

/// Quick exam-day picks are stored in order, and a reload of the projects meanwhile
/// does not put back the day stored before them.
#[gpui_kit::test]
fn quick_exam_picks_survive_a_reload_and_the_last_is_stored(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.create_project("Biology").unwrap();
    let (_window, shell) = open_shell(cx, app.app(), Preferences::default());
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_session_list(cx)));
    cx.run_until_parked();

    let date = |day| chrono::NaiveDate::from_ymd_opt(2027, 6, day);
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.show_project(project.id);
            shell.save_exam(date(10), cx);
            shell.load_session_list(cx);
            shell.save_exam(date(20), cx);
            shell.load_session_list(cx);
        })
    });
    cx.run_until_parked();

    let picked = Day::new(2027, 6, 20);
    let shown = cx.update(|cx| shell.read(cx).project(project.id).unwrap().exam_on);
    assert_eq!(shown, picked);
    let stored = app.projects().unwrap()[0].exam_on;
    assert_eq!(stored, picked);
}

/// A read of the projects that misses an exam pick, made after it started or still
/// saving as it did, does not take the pick back when it ends after the pick is stored.
#[gpui_kit::test]
fn a_read_that_missed_an_exam_pick_does_not_take_it_back(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.create_project("Biology").unwrap();
    let (_window, shell) = open_shell(cx, app.app(), Preferences::default());
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_session_list(cx)));
    cx.run_until_parked();
    let date = |day| chrono::NaiveDate::from_ymd_opt(2027, 6, day);
    let shown = |cx: &mut TestAppContext| {
        cx.update(|cx| shell.read(cx).project(project.id).unwrap().exam_on)
    };

    // Picked after the read started.
    let (mark, read) = cx.update(|cx| (shell.read(cx).projects.exam_mark(), app.projects()));
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.show_project(project.id);
            shell.save_exam(date(10), cx);
        })
    });
    cx.run_until_parked();
    let picked = Day::new(2027, 6, 10);
    assert_eq!(app.projects().unwrap()[0].exam_on, picked);
    cx.update(|cx| shell.update(cx, |shell, _| shell.show_projects(read.unwrap(), &mark)));
    assert_eq!(shown(cx), picked);

    // Picked before the read started, and stored after.
    let mark = cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.save_exam(date(20), cx);
            shell.projects.exam_mark()
        })
    });
    let read = app.projects().unwrap();
    cx.run_until_parked();
    let picked = Day::new(2027, 6, 20);
    assert_eq!(app.projects().unwrap()[0].exam_on, picked);
    cx.update(|cx| shell.update(cx, |shell, _| shell.show_projects(read, &mark)));
    assert_eq!(shown(cx), picked);
}

/// A project lists its three kinds of material: the one made says it is up to date and opens on
/// its page, the others say they are not made yet, and a project's quiz is a click away.
#[gpui_kit::test]
fn a_project_lists_its_material_and_opens_each_piece(cx: &mut TestAppContext) {
    use crate::ui::screens::shell::page::pages::study::MaterialStatus;
    use study_core::{ArtifactBody, ArtifactKind, JobKind};

    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let file = app.dir().join("Cells.txt");
    std::fs::write(&file, "mitochondria").unwrap();
    let source = database.import_source(&file, Some(project.id)).unwrap();
    let (notes, _) = database
        .request_update(project.id, ArtifactKind::Diagram, &[source.id])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(notes).unwrap();
    database
        .finish_artifact(
            notes,
            &ArtifactBody::Diagram {
                mermaid: "one".into(),
            },
            &[],
        )
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_session_list(cx)));
    cx.run_until_parked();
    let row = |kind: ArtifactKind| {
        let place = ArtifactKind::ALL.iter().position(|k| *k == kind).unwrap();
        (ids::MATERIAL_ROW, place as u64)
    };
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.navigate(Page::Projects, cx);
            shell.show_project(project.id);
            cx.notify();
        })
    });
    wait_until(cx, |cx| {
        cx.update(|cx| {
            shell
                .read(cx)
                .material_line(project.id, ArtifactKind::Diagram)
                .is_some()
        })
    });
    render(cx, window);
    let line = cx
        .update(|cx| {
            shell
                .read(cx)
                .material_line(project.id, ArtifactKind::Diagram)
        })
        .unwrap();
    assert_eq!(line.status, MaterialStatus::UpToDate);
    assert_eq!(line.status.label(Locale::English), "Up to date");
    assert!(
        cx.update(|cx| shell
            .read(cx)
            .material_line(project.id, ArtifactKind::Flashcards))
            .is_none(),
        "a kind never made has no line"
    );
    for kind in ArtifactKind::ALL {
        assert!(find(cx, window, row(*kind)).is_some(), "{kind:?} has a row");
    }

    // The piece opens on its page.
    click(cx, window, row(ArtifactKind::Diagram));
    cx.run_until_parked();
    assert_eq!(
        cx.update(|cx| shell.read(cx).active),
        Page::Diagrams,
        "the piece opens on its page"
    );

    // A kind not made opens where it is made.
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.navigate(Page::Projects, cx);
            shell.show_project(project.id);
        })
    });
    render(cx, window);
    click(cx, window, row(ArtifactKind::Diagram));
    cx.run_until_parked();
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Diagrams);

    // The quiz opens on the quiz page.
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.navigate(Page::Projects, cx);
            shell.show_project(project.id);
        })
    });
    render(cx, window);
    click(cx, window, ids::OPEN_QUIZ);
    cx.run_until_parked();
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Practice);
}

/// A project's row says when a piece is being updated, or the update failed, and still opens
/// the piece.
#[gpui_kit::test]
fn a_project_row_says_how_the_update_is_going(cx: &mut TestAppContext) {
    use crate::ui::screens::shell::page::pages::study::MaterialStatus;
    use study_core::{ArtifactBody, ArtifactKind, ErrorKind, Failure, JobKind};

    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let file = app.dir().join("Cells.txt");
    std::fs::write(&file, "mitochondria").unwrap();
    let source = database.import_source(&file, Some(project.id)).unwrap();
    let (first, _) = database
        .request_update(project.id, ArtifactKind::Diagram, &[source.id])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(first).unwrap();
    database
        .finish_artifact(
            first,
            &ArtifactBody::Diagram {
                mermaid: "one".into(),
            },
            &[],
        )
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();
    let (_, next) = database
        .request_update(project.id, ArtifactKind::Diagram, &[source.id])
        .unwrap();

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_session_list(cx)));
    cx.run_until_parked();
    let status = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            shell
                .read(cx)
                .material_line(project.id, ArtifactKind::Diagram)
                .map(|line| line.status)
        })
    };
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.navigate(Page::Projects, cx);
            shell.show_project(project.id);
        })
    });
    wait_until(cx, |cx| status(cx).is_some());
    assert_eq!(status(cx), Some(MaterialStatus::Updating));

    // Its job failed: the row says so, and still opens the piece.
    let next = next.unwrap();
    database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database
        .fail_job(next, &Failure::new(ErrorKind::Internal, "broke"), None)
        .unwrap();
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_study(cx)));
    wait_until(cx, |cx| status(cx) == Some(MaterialStatus::UpdateFailed));
    render(cx, window);
    let place = ArtifactKind::ALL
        .iter()
        .position(|kind| *kind == ArtifactKind::Diagram)
        .unwrap();
    click(cx, window, (ids::MATERIAL_ROW, place as u64));
    cx.run_until_parked();
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Diagrams);
}

/// A project's row says a first write that stopped could not be written.
#[gpui_kit::test]
fn a_project_row_says_a_first_write_failed(cx: &mut TestAppContext) {
    use crate::ui::screens::shell::page::pages::study::MaterialStatus;
    use study_core::{ArtifactKind, ErrorKind, Failure, JobKind};

    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let file = app.dir().join("Cells.txt");
    std::fs::write(&file, "mitochondria").unwrap();
    let source = database.import_source(&file, Some(project.id)).unwrap();
    let (id, job) = database
        .request_update(project.id, ArtifactKind::Diagram, &[source.id])
        .unwrap();
    database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(id).unwrap();
    database
        .fail_job(
            job.unwrap(),
            &Failure::new(ErrorKind::Internal, "broke"),
            None,
        )
        .unwrap();

    let (_window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_session_list(cx)));
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.navigate(Page::Projects, cx);
            shell.show_project(project.id);
        })
    });
    let line = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            shell
                .read(cx)
                .material_line(project.id, ArtifactKind::Diagram)
        })
    };
    wait_until(cx, |cx| line(cx).is_some());
    let status = line(cx).unwrap().status;
    assert_eq!(status, MaterialStatus::WriteFailed);
    assert_eq!(status.label(Locale::English), "Couldn't write");
    assert_eq!(status.label(Locale::Italian), "Scrittura non riuscita");
}
