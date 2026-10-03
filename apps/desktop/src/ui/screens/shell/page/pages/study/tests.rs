//! The pages of material, end to end: loading, the sidebar, making material from a whole
//! project, reviewing due cards, and opening and editing material.

use super::ids;
use super::page::{Shown, StudyRead};
use crate::app::preferences::Preferences;
use crate::testing::TempApp;
use crate::ui::screens::shell::page::testing::{
    click, find, open_offline_shell, open_shell, render, set_workers, wait_until, without_workers,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::{AppContext as _, TestAppContext};
use study_app::views::{ArtifactBody, ArtifactKind, Flashcard, JobKind};
use study_core::db::Database;
use study_core::{ArtifactId, ProjectId, SourceId};

/// The rail buttons of the pages of material.
const NOTES_RAIL: usize = Page::Notes as usize;
const FLASHCARDS_RAIL: usize = Page::Flashcards as usize;
const DIAGRAMS_RAIL: usize = Page::Diagrams as usize;

/// The sidebar item of a piece of material.
fn row(id: ArtifactId) -> (&'static str, u64) {
    (ids::MATERIAL_ROW, id.get() as u64)
}

/// A project named `name` with one file in it, which material is made from.
fn project_with_file(app: &TempApp, name: &str) -> (ProjectId, SourceId) {
    let database = app.database();
    let project = database.create_project(name).unwrap();
    let file = app.dir().join(format!("{name}.txt"));
    std::fs::write(&file, "mitochondria").unwrap();
    let source = database.import_source(&file, Some(project.id)).unwrap();
    (project.id, source.id)
}

/// Writes a set of flashcards from `source`, as its writer would, one card per `(front,
/// back)`, and returns it.
fn write_flashcards(
    database: &Database,
    project: ProjectId,
    source: SourceId,
    cards: &[(&str, &str)],
) -> ArtifactId {
    let (id, _) = database
        .request_update(project, ArtifactKind::Flashcards, &[source])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(id).unwrap();
    let cards = cards
        .iter()
        .map(|&(front, back)| Flashcard {
            front: front.into(),
            back: back.into(),
            cites: Vec::new(),
        })
        .collect();
    database
        .finish_artifact(id, &ArtifactBody::Flashcards { cards }, &[])
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();
    id
}

/// The two cards most tests review: what powers the cell, and what builds proteins.
const CELL_CARDS: [(&str, &str); 2] = [
    ("What powers the cell?", "answer"),
    ("What builds proteins?", "answer"),
];

#[test]
fn a_load_reads_every_projects_material_and_due_cards() -> study_core::Result<()> {
    let app = TempApp::new();
    let empty = StudyRead::read(&app)?;
    assert!(empty.projects.is_empty() && empty.material.is_empty());

    let database = app.database();
    let (biology, source) = project_with_file(&app, "Biology");
    let (history, other) = project_with_file(&app, "History");
    write_flashcards(&database, biology, source, &CELL_CARDS);
    database.request_update(history, ArtifactKind::Notes, &[other])?;

    let read = StudyRead::read(&app)?;
    assert_eq!(read.projects.len(), 2);
    assert_eq!(read.material.len(), 2);
    assert_eq!(read.due.get(&biology), Some(&2));
    assert_eq!(read.due.get(&history), Some(&0));
    Ok(())
}

#[gpui_kit::test]
fn due_flashcards_are_reviewed_one_at_a_time(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    // Nothing runs in this test; a real model would not be deterministic.
    without_workers(cx, &shell);

    click(cx, window, FLASHCARDS_RAIL);
    let listed = cx.update(|cx| {
        let state = &shell.read(cx).study;
        (
            state.shown(),
            state.material.len(),
            state.due.get(&project).copied(),
        )
    });
    assert_eq!(listed, (Shown::Reviews, 1, Some(2)));

    click(cx, window, ids::REVIEW);
    // The card under review is named by the side it shows and what that says.
    let face = |cx: &mut TestAppContext| {
        find(cx, window, ids::REVIEW_FACE).and_then(|face| face.label().map(str::to_owned))
    };
    assert!(face(cx).is_some_and(|label| label.starts_with("Question · What")));
    click(cx, window, ids::SHOW_ANSWER);
    assert_eq!(face(cx).as_deref(), Some("Answer · answer"));
    click(cx, window, ids::RATE + 2);
    let review = cx.update(|cx| {
        let review = shell.read(cx).study.review.as_ref().unwrap();
        (review.index, review.revealed)
    });
    assert_eq!(review, (1, false));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    assert_eq!(
        database
            .count_due_cards(Some(project), now, usize::MAX)
            .unwrap(),
        1
    );
}

/// Opened flashcards turn over all at once and back, copy as Anki imports them, and
/// the piece is not offered an update until its project moves on.
#[gpui_kit::test]
fn opened_cards_turn_over_and_writing_again_asks_first(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let id = write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, row(id));
    assert_eq!(
        cx.update(|cx| shell.read(cx).study.shown()),
        Shown::Material(id)
    );

    let turned = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).study.turned.len());
    render(cx, window);
    cx.simulate_keystrokes(window, "space");
    assert_eq!(turned(cx), 1, "Space turns the next card");
    click(cx, window, ids::TURN_ALL);
    assert_eq!(turned(cx), 2);
    click(cx, window, ids::TURN_ALL);
    assert_eq!(turned(cx), 0);

    // The deck's card reads as a button that shows its answer, then hides it again, named
    // by the side it shows and what that side says.
    let deck_card = |cx: &mut TestAppContext| find(cx, window, ids::DECK_CARD).unwrap();
    let deck_label = |cx: &mut TestAppContext| deck_card(cx).label().map(str::to_owned);
    assert_eq!(deck_card(cx).role(), Some(gpui_kit::Role::Button));
    assert_eq!(
        deck_label(cx).as_deref(),
        Some("Show answer · Question · What powers the cell?")
    );
    click(cx, window, ids::DECK_CARD);
    assert_eq!(turned(cx), 1);
    assert_eq!(
        deck_label(cx).as_deref(),
        Some("Hide answer · Answer · answer")
    );
    click(cx, window, ids::DECK_CARD);
    assert_eq!(turned(cx), 0);

    click(cx, window, ids::COPY);
    let copied = cx.update(|cx| cx.read_from_clipboard().and_then(|item| item.text()));
    assert_eq!(
        copied.as_deref(),
        Some("What powers the cell?\tanswer\nWhat builds proteins?\tanswer")
    );
    assert_eq!(cx.update(|cx| shell.read(cx).study.copied), Some(id));

    assert!(
        find(cx, window, ids::UPDATE).is_none(),
        "a piece nothing changed in offers no update"
    );
    assert!(database.artifact(id).unwrap().unwrap().body.is_some());
}

/// A review takes the keyboard: Space shows the answer, and once it shows, a digit rates
/// the card. Space never rates one.
#[gpui_kit::test]
fn cards_are_reviewed_with_the_keyboard(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, ids::REVIEW);
    render(cx, window);
    let review = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let review = shell.read(cx).study.review.as_ref().unwrap();
            (review.index, review.revealed)
        })
    };

    cx.simulate_keystrokes(window, "space");
    assert_eq!(review(cx), (0, true));
    cx.simulate_keystrokes(window, "1");
    assert_eq!(review(cx), (1, false));
    cx.simulate_keystrokes(window, "3");
    assert_eq!(review(cx), (1, false), "a rating waits for the answer");
    cx.simulate_keystrokes(window, "space space");
    assert_eq!(review(cx), (1, true), "Space never rates");
    cx.simulate_keystrokes(window, "4");
    assert_eq!(review(cx), (2, false));
}

/// A review left for another page takes the keyboard again when the sidebar brings it back,
/// before anything is clicked, and keeps it after Show answer is clicked.
#[gpui_kit::test]
fn a_review_shown_again_takes_the_keyboard(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, ids::REVIEW);
    render(cx, window);
    click(cx, window, Page::Home as usize);
    click(cx, window, FLASHCARDS_RAIL);
    render(cx, window);
    let review = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let review = shell.read(cx).study.review.as_ref().unwrap();
            (review.index, review.revealed)
        })
    };

    cx.simulate_keystrokes(window, "space");
    assert_eq!(review(cx), (0, true));
    cx.simulate_keystrokes(window, "3");
    assert_eq!(review(cx), (1, false));
    click(cx, window, ids::SHOW_ANSWER);
    assert_eq!(review(cx), (1, true));
    cx.simulate_keystrokes(window, "3");
    assert_eq!(review(cx), (2, false));
}

/// An opened deck left for another page takes the keyboard again when the sidebar brings
/// it back.
#[gpui_kit::test]
fn a_deck_shown_again_takes_the_keyboard(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let id = write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, row(id));
    render(cx, window);
    click(cx, window, Page::Home as usize);
    click(cx, window, FLASHCARDS_RAIL);
    render(cx, window);
    assert_eq!(
        cx.update(|cx| shell.read(cx).study.shown()),
        Shown::Material(id)
    );

    let turned = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).study.turned.len());
    cx.simulate_keystrokes(window, "space");
    assert_eq!(turned(cx), 1, "Space turns the card");
}

/// Each page lists only material of its kind, and opens on the newest.
#[gpui_kit::test]
fn each_page_lists_its_own_kind(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let make = |kind| database.request_update(project, kind, &[source]).unwrap().0;
    let notes = make(ArtifactKind::Notes);
    let diagram = make(ArtifactKind::Diagram);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    let shown = |cx: &mut TestAppContext, id: ArtifactId| find(cx, window, row(id)).is_some();
    click(cx, window, NOTES_RAIL);
    assert!(shown(cx, notes) && !shown(cx, diagram));
    assert_eq!(
        cx.update(|cx| shell.read(cx).study.shown()),
        Shown::Material(notes)
    );
    click(cx, window, DIAGRAMS_RAIL);
    assert!(!shown(cx, notes) && shown(cx, diagram));

    // Each page keeps what its sidebar picked.
    click(cx, window, DIAGRAMS_RAIL);
    assert_eq!(
        cx.update(|cx| shell.read(cx).study.shown()),
        Shown::Material(diagram)
    );
}

/// Make on a project with nothing yet writes the page's kind from the whole project.
#[gpui_kit::test]
fn material_is_made_from_the_whole_project(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let biology = database.create_project("Biology").unwrap();
    let cells = database.create_session(biology.id, "Cells").unwrap();
    let mitosis = database.create_session(biology.id, "Mitosis").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    for (session, note) in [(cells.id, "ATP"), (mitosis.id, "Spindles")] {
        app.post_message(session, note, &[]).unwrap();
    }
    click(cx, window, Page::Notes as usize);
    wait_until(cx, |cx| {
        cx.update(|cx| !shell.read(cx).study.projects.is_empty())
    });
    click(cx, window, ids::MAKE);
    wait_until(cx, |_| !app.material(biology.id).unwrap().is_empty());
    let material = app.material(biology.id).unwrap();
    let made = material[0]
        .update
        .as_ref()
        .or(material[0].current.as_ref())
        .unwrap();
    assert_eq!(made.kind, ArtifactKind::Notes);
    assert_eq!(made.notes.lines().collect::<Vec<_>>(), ["ATP", "Spindles"]);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).study.shown()) == Shown::Material(made.id)
    });
}

/// Home's Today card reviews the cards due in every project, without choosing one.
#[gpui_kit::test]
fn everything_due_is_reviewed_across_projects(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    for name in ["Biology", "History"] {
        let (project, source) = project_with_file(&app, name);
        let front = format!("{name}?");
        write_flashcards(&database, project, source, &[(&front, "answer")]);
    }
    let snapshot = crate::features::dashboard::load(&app).unwrap();
    assert_eq!(snapshot.due_cards, 2);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    cx.update(|cx| shell.update(cx, |shell, cx| shell.review_everything_due(cx)));
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Flashcards);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).study.review.is_some())
    });
    render(cx, window);
    let cards = cx.update(|cx| shell.read(cx).study.review.as_ref().unwrap().cards.len());
    assert_eq!(cards, 2, "both projects' cards");
    assert!(find(cx, window, ids::SHOW_ANSWER).is_some());
}

/// Deleting material asks first; Cancel keeps it, Delete takes it.
#[gpui_kit::test]
fn deleting_material_asks_first(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let (id, _) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    click(cx, window, row(id));
    click(cx, window, ids::DELETE);
    assert!(database.artifact(id).unwrap().is_some(), "only asked");
    click(cx, window, ids::CANCEL_DELETE);
    assert_eq!(cx.update(|cx| shell.read(cx).study.deleting), None);
    click(cx, window, ids::DELETE);
    click(cx, window, ids::CONFIRM_DELETE);
    wait_until(cx, |_| database.artifact(id).unwrap().is_none());
    // With nothing left of its kind, the page offers to make one.
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).study.shown()) == Shown::Empty(Some(project))
    });
}

/// A card is rewritten, added and deleted in place, in the set and its reviews.
#[gpui_kit::test]
fn cards_are_edited_added_and_deleted(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let id = write_flashcards(
        &database,
        project,
        source,
        &[("What powers the cell?", "Ribosomes")],
    );

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, row(id));
    let fill = |cx: &mut TestAppContext, front: &str, back: &str| {
        let (front, back) = (front.to_owned(), back.to_owned());
        cx.update_window(window, |_, window, cx| {
            let editor = shell.read(cx).study.card_editor.as_ref().unwrap();
            let (front_box, back_box) = (editor.front.clone(), editor.back.clone());
            front_box.update(cx, |input, cx| input.set_value(front, window, cx));
            back_box.update(cx, |input, cx| input.set_value(back, window, cx));
        })
        .unwrap();
    };
    let sides = || -> Vec<(String, String)> {
        database
            .cards_of(id)
            .unwrap()
            .into_iter()
            .map(|card| (card.front, card.back))
            .collect()
    };
    let first_card = (ids::CARD_EDIT, ids::packed(id, 0));

    click(cx, window, first_card);
    fill(cx, "What powers the cell?", "Mitochondria");
    click(cx, window, ids::CARD_SAVE);
    wait_until(cx, |_| sides()[0].1 == "Mitochondria");

    click(cx, window, ids::CARD_ADD);
    // Space types a space in the card being written; it turns no card over.
    render(cx, window);
    cx.simulate_keystrokes(window, "space");
    assert!(cx.update(|cx| shell.read(cx).study.turned.is_empty()));
    fill(cx, "What builds proteins?", "Ribosomes");
    click(cx, window, ids::CARD_SAVE);
    wait_until(cx, |_| sides().len() == 2);

    click(cx, window, first_card);
    click(cx, window, ids::CARD_DELETE);
    assert_eq!(sides().len(), 2, "only asked");
    click(cx, window, ids::CARD_CONFIRM_DELETE);
    wait_until(cx, |_| {
        sides() == [("What builds proteins?".to_owned(), "Ribosomes".to_owned())]
    });
}

/// A card whose save does not work stays open with what was written, and says so.
#[gpui_kit::test]
fn a_card_that_cannot_be_saved_stays_open(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let id = write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, row(id));
    click(cx, window, (ids::CARD_EDIT, ids::packed(id, 1)));
    cx.update_window(window, |_, window, cx| {
        let back = shell
            .read(cx)
            .study
            .card_editor
            .as_ref()
            .unwrap()
            .back
            .clone();
        back.update(cx, |input, cx| input.set_value("Mitochondria", window, cx));
    })
    .unwrap();
    // Both cards go meanwhile, so there is no second card to save over.
    for _ in 0..2 {
        assert!(
            database
                .set_card(id, 0, &study_app::views::CardChange::Delete)
                .unwrap()
        );
    }

    click(cx, window, ids::CARD_SAVE);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).study.error) == Some(Message::ActionError)
    });
    let kept = cx.update(|cx| {
        let editor = shell.read(cx).study.card_editor.as_ref().unwrap();
        (editor.saving, editor.back.read(cx).value().to_string())
    });
    assert_eq!(kept, (false, "Mitochondria".to_owned()));
}

/// What was under way on one piece of material is not left waiting on another, nor on
/// another page.
#[gpui_kit::test]
fn opening_another_piece_drops_what_was_under_way(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let id = write_flashcards(&database, project, source, &CELL_CARDS);
    let (history, history_source) = project_with_file(&app, "History");
    let other = write_flashcards(&database, history, history_source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    let left = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let state = &shell.read(cx).study;
            (state.copied, state.saved)
        })
    };
    let busy = |cx: &mut TestAppContext| {
        click(cx, window, ids::COPY);
        cx.update(|cx| shell.update(cx, |shell, _| shell.study.saved = Some(id)));
    };
    // Asking to write it again opens an alert over the window, so the moves away are made
    // as a link or the search would make them.
    let go = |cx: &mut TestAppContext, to: Option<ArtifactId>| {
        cx.update(|cx| {
            shell.update(cx, |shell, cx| match to {
                Some(to) => shell.show_material(ArtifactKind::Flashcards, to, cx),
                None => shell.navigate(Page::Notes, cx),
            })
        });
        cx.run_until_parked();
    };
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, row(id));
    busy(cx);
    go(cx, Some(other));
    assert_eq!(left(cx), (None, None));

    go(cx, Some(id));
    busy(cx);
    go(cx, None);
    assert_eq!(left(cx), (None, None));
}

/// An open diagram keeps its canvas from frame to frame, and gets a new one once it is
/// written again or the interface speaks another language.
#[gpui_kit::test]
fn an_open_diagram_is_drawn_again_when_it_or_the_language_changes(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let (id, _) = database
        .request_update(project, ArtifactKind::Diagram, &[source])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(id).unwrap();
    let body = |mermaid: &str| ArtifactBody::Diagram {
        mermaid: mermaid.into(),
    };
    database
        .finish_artifact(id, &body("flowchart TD\n  a[Cell] --> b[Nucleus]\n"), &[])
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, DIAGRAMS_RAIL);
    click(cx, window, row(id));
    let canvas = |cx: &mut TestAppContext| {
        render(cx, window);
        cx.update(|cx| {
            let (_, canvas) = shell.read(cx).study.diagram.as_ref().unwrap();
            canvas.entity_id()
        })
    };
    let first = canvas(cx);
    assert_eq!(canvas(cx), first);

    // What a reload brings once the diagram is written again under the same id.
    cx.update(|cx| {
        shell.update(cx, |shell, _| {
            let piece = shell
                .study
                .material
                .iter_mut()
                .find(|piece| piece.head().id == id)
                .unwrap();
            let rewritten = Some(body("flowchart TD\n  a[Cell] --> c[Membrane]\n"));
            piece.current.as_mut().unwrap().body = rewritten;
        })
    });
    let rewritten = canvas(cx);
    assert_ne!(rewritten, first);

    cx.update(|cx| shell.update(cx, |shell, _| shell.preferences.language = Locale::Italian));
    assert_ne!(canvas(cx), rewritten);
}

/// A review opens only while the reviews are still on screen: not over material, nor on
/// another page, picked meanwhile.
#[gpui_kit::test]
fn a_late_review_does_not_open_over_what_was_picked_meanwhile(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let id = write_flashcards(&database, project, source, &CELL_CARDS);

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, FLASHCARDS_RAIL);
    let reviewing = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).study.review.is_some());

    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.review_due(Some(project), cx);
            shell.choose_material(Shown::Material(id), cx);
        })
    });
    cx.run_until_parked();
    assert!(!reviewing(cx));
    assert_eq!(
        cx.update(|cx| shell.read(cx).study.shown()),
        Shown::Material(id)
    );

    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.choose_material(Shown::Reviews, cx);
            shell.review_due(None, cx);
            shell.navigate(Page::Notes, cx);
        })
    });
    cx.run_until_parked();
    assert!(!reviewing(cx));

    // Nothing changed meanwhile: the review opens.
    click(cx, window, FLASHCARDS_RAIL);
    click(cx, window, (ids::REVIEW_PROJECT, project.get() as u64));
    assert!(reviewing(cx));
}

/// A cited source opens over the material, on the cited passage, without leaving the page.
#[gpui_kit::test]
fn a_citation_opens_its_passage_over_the_page(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let blocks = [
        "Cells divide.",
        "Mitosis has four phases.",
        "Then cytokinesis.",
    ]
    .iter()
    .zip(1..)
    .map(|(text, page)| study_app::views::Block {
        kind: study_app::views::BlockKind::Paragraph,
        text: (*text).to_owned(),
        anchor: study_app::views::Anchor::Page { page },
    })
    .collect();
    database
        .save_document(
            source,
            &study_app::views::Document {
                blocks,
                meta: Default::default(),
            },
        )
        .unwrap();
    let (id, _) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(id).unwrap();
    let cited = study_app::views::Citation {
        marker: 1,
        source_id: Some(source),
        source_name: "Biology.txt".into(),
        anchor: study_app::views::Anchor::Page { page: 2 },
        quote: "Mitosis has four phases.".into(),
    };
    database
        .finish_artifact(
            id,
            &ArtifactBody::Text {
                text: "Mitosis has four phases [1].".into(),
            },
            &[cited],
        )
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    // What the citation's chip does when clicked.
    let cited = cx.update(|cx| shell.read(cx).study.open_artifact().unwrap().citations[0].clone());
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.peek_source(
                cited.source_id.unwrap(),
                cited.source_name.clone(),
                cited.anchor.clone(),
                window,
                cx,
            )
        })
    })
    .unwrap();
    wait_until(cx, |cx| cx.update(|cx| shell.read(cx).peek.loaded()));
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Notes);
    assert_eq!(
        cx.update(|cx| shell.read(cx).peek.marked()),
        ["Mitosis has four phases.".to_owned()]
    );
}

/// A setup-waiting writer offers Settings instead of spinning or retrying before setup.
#[gpui_kit::test]
fn material_waiting_for_sign_in_offers_settings(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let (id, _) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database
        .fail_job(
            job.id,
            &study_core::Failure::new(study_core::ErrorKind::Auth, "sign in"),
            None,
        )
        .unwrap();
    assert_eq!(
        database.job(job.id).unwrap().unwrap().status,
        study_core::JobStatus::Waiting
    );

    let (window, _shell) = open_offline_shell(cx, &app, false);
    click(cx, window, NOTES_RAIL);
    click(cx, window, row(id));
    assert!(find(cx, window, (ids::MATERIAL_SETTINGS, id.get() as u64)).is_some());
    assert!(find(cx, window, (ids::MATERIAL_RETRY, id.get() as u64)).is_none());
}

/// Writes notes from `source`, as its writer would, and returns its id.
fn write_notes(
    database: &Database,
    project: ProjectId,
    source: SourceId,
    text: &str,
) -> ArtifactId {
    let (id, _) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    let job = database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(id).unwrap();
    database
        .finish_artifact(id, &ArtifactBody::Text { text: text.into() }, &[])
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();
    id
}

/// Reads the pages of material again, and waits until `done` holds of what they read.
fn reload(
    cx: &mut TestAppContext,
    shell: &gpui_kit::Entity<AppShell>,
    done: impl Fn(&super::page::StudyState) -> bool,
) {
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_study(cx)));
    wait_until(cx, |cx| cx.update(|cx| done(&shell.read(cx).study)));
}

/// Each status of a piece is said in its own words, the same on the page and in its
/// project's row (both read `MaterialStatus::label`): up to date, outdated with what changed and Update (only once something
/// changed), updating with the current text still on screen and no second Update, and a
/// failed update with a way to try again.
#[gpui_kit::test]
fn a_piece_says_one_status_in_the_same_words_everywhere(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let first = write_notes(&database, project, source, "one");
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    let status = |cx: &mut TestAppContext| {
        find(cx, window, ids::STATUS).and_then(|status| status.label().map(str::to_owned))
    };
    assert_eq!(status(cx).as_deref(), Some("Up to date"));
    assert!(find(cx, window, ids::UPDATE).is_none(), "nothing changed");

    // A file filed in the project since: one file changed.
    let extra = app.dir().join("Genetics.txt");
    std::fs::write(&extra, "alleles").unwrap();
    database.import_source(&extra, Some(project)).unwrap();
    reload(cx, &shell, |state| {
        state
            .open_piece()
            .is_some_and(|piece| piece.changes.files == 1)
    });
    assert_eq!(status(cx).as_deref(), Some("Outdated · 1 file changed"));
    let update = find(cx, window, ids::UPDATE).expect("an outdated piece offers an update");
    assert_ne!(update.disabled(), Some(true), "Update is available");

    // The update is on its way: the current text stays, and there is nothing to click twice.
    let (second, job) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    reload(cx, &shell, |state| {
        state.open_piece().is_some_and(|piece| piece.updating())
    });
    let shown = |cx: &mut TestAppContext| {
        cx.update(|cx| shell.read(cx).study.open_artifact().map(|a| a.id))
    };
    assert_eq!(shown(cx), Some(first), "the current text stays on screen");
    assert_eq!(status(cx).as_deref(), Some("Updating…"));
    assert!(
        find(cx, window, ids::UPDATE).is_none(),
        "no Update meanwhile"
    );
    set_workers(
        cx,
        &shell,
        crate::ui::screens::shell::page::workers::WorkersState::Ready,
    );
    render(cx, window);
    assert!(find(cx, window, ids::UPDATE).is_none());
    assert_eq!(
        database
            .request_update(project, ArtifactKind::Notes, &[source])
            .unwrap()
            .0,
        second,
        "nothing more is queued"
    );

    // It failed: the current text stays, with a way to try again.
    let job = job.unwrap();
    database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(second).unwrap();
    let failure = study_core::Failure::new(study_core::ErrorKind::Internal, "the writer broke");
    database.fail_job(job, &failure, None).unwrap();
    reload(cx, &shell, |state| {
        state
            .open_piece()
            .is_some_and(|piece| piece.status() == super::page::MaterialStatus::UpdateFailed)
    });
    assert_eq!(shown(cx), Some(first));
    assert_eq!(
        status(cx).as_deref(),
        Some("Couldn't update · showing the last one")
    );
    assert!(
        find(cx, window, (ids::MATERIAL_RETRY, second.get() as u64)).is_some(),
        "the failed update can be tried again"
    );
    assert!(find(cx, window, ids::UPDATE).is_none());
}

/// Updating a piece keeps its current text on screen, and the finished update takes its
/// place under the id it was asked for, with nothing old kept.
#[gpui_kit::test]
fn an_update_keeps_the_current_text_until_it_is_done(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let first = write_notes(&database, project, source, "one");
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    let body = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            shell
                .read(cx)
                .study
                .open_artifact()
                .and_then(|artifact| artifact.body.clone())
        })
    };
    let one = Some(ArtifactBody::Text { text: "one".into() });
    assert_eq!(body(cx), one);

    let (second, job) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    reload(cx, &shell, |state| {
        state.open_piece().is_some_and(|piece| piece.updating())
    });
    assert_eq!(
        body(cx),
        one,
        "the current text stays while it is rewritten"
    );

    database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
    database.begin_artifact(second).unwrap();
    database
        .finish_artifact(second, &ArtifactBody::Text { text: "two".into() }, &[])
        .unwrap();
    database.succeed_job(job.unwrap(), &[]).unwrap();
    reload(cx, &shell, |state| {
        state.open_piece().is_some_and(|piece| !piece.updating())
    });
    assert_eq!(body(cx), Some(ArtifactBody::Text { text: "two".into() }));
    assert!(
        database.artifact(first).unwrap().is_none(),
        "nothing old is kept"
    );
}

/// A piece is titled after its project, so the line under the title does not say the
/// project again; a piece titled otherwise still does.
#[gpui_kit::test]
fn the_header_facts_leave_out_a_project_that_the_title_already_names(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    write_notes(&database, project, source, "one");
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    cx.update(|cx| {
        let shell = shell.read(cx);
        let mut artifact = shell.study.open_artifact().unwrap().clone();
        let locale = Locale::English;
        artifact.title = "Biology".to_owned();
        let same = shell.material_facts(&artifact, locale);
        assert!(
            same.iter().all(|fact| !fact.contains("Biology")),
            "{same:?}"
        );
        assert_eq!(
            same.last().map(String::as_str),
            Some("1 source"),
            "{same:?}"
        );
        artifact.title = "Mistakes".to_owned();
        let other = shell.material_facts(&artifact, locale);
        assert_eq!(other.first().map(String::as_str), Some("Biology"));
    });
}

/// A project with nothing to write from offers no Make.
#[gpui_kit::test]
fn a_project_with_nothing_to_offer_has_no_make(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.database().create_project("Biology").unwrap().id;
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    assert_eq!(
        cx.update(|cx| shell.read(cx).study.shown()),
        Shown::Empty(Some(project))
    );
    assert!(find(cx, window, ids::MAKE).is_none());
}

/// Deleting a piece takes its update with it.
#[gpui_kit::test]
fn deleting_a_piece_removes_its_update(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    let first = write_notes(&database, project, source, "one");
    let (second, _) = database
        .request_update(project, ArtifactKind::Notes, &[source])
        .unwrap();
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    click(cx, window, ids::DELETE);
    click(cx, window, ids::CONFIRM_DELETE);
    wait_until(cx, |_| {
        database.artifact(first).unwrap().is_none() && database.artifact(second).unwrap().is_none()
    });
}

/// Update is reached with Tab.
#[gpui_kit::test]
fn update_is_reached_from_the_keyboard(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let (project, source) = project_with_file(&app, "Biology");
    write_notes(&database, project, source, "one");
    let extra = app.dir().join("Genetics.txt");
    std::fs::write(&extra, "alleles").unwrap();
    database.import_source(&extra, Some(project)).unwrap();
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    without_workers(cx, &shell);
    click(cx, window, NOTES_RAIL);
    reload(cx, &shell, |state| {
        state
            .open_piece()
            .is_some_and(|piece| piece.changes.files == 1)
    });
    render(cx, window);

    // The innermost element holding the keyboard, by its own id.
    let focused = |cx: &mut TestAppContext| -> Option<gpui_kit::ElementId> {
        cx.update_window(window, |_, window, cx| {
            gpui_kit::test::TestWindowExt::render_frame(window, cx);
            gpui_kit::base::test_support::snapshots(window)
                .into_iter()
                .filter(|element| format!("{element:?}").contains("focused: Some(true)"))
                .max_by_key(|element| element.path().len())
                .and_then(|element| element.path().last().cloned())
        })
        .unwrap()
    };
    // Tabs on until `id` has the keyboard.
    let reach = |cx: &mut TestAppContext, id: gpui_kit::ElementId| {
        for _ in 0..80 {
            if focused(cx).as_ref() == Some(&id) {
                return;
            }
            cx.simulate_keystrokes(window, "tab");
        }
        panic!("Tab never reached {id:?}");
    };

    reach(cx, ids::UPDATE.into());
}

/// Every arm of a piece's status, read from the database as the pages read it.
#[test]
fn a_piece_reads_each_status_from_its_current_text_and_its_update() {
    use super::page::MaterialStatus::*;

    let app = TempApp::new();
    let database = app.database();
    let fail = |id: ArtifactId, job: Option<study_core::JobId>| {
        database.claim_job(&[JobKind::Artifact]).unwrap().unwrap();
        database.begin_artifact(id).unwrap();
        let failure = study_core::Failure::new(study_core::ErrorKind::Internal, "broke");
        database.fail_job(job.unwrap(), &failure, None).unwrap();
    };
    let ask = |project, source| {
        database
            .request_update(project, ArtifactKind::Notes, &[source])
            .unwrap()
    };

    // The jobs that fail are claimed first, so each is the oldest one queued.
    let (write_failed, source) = project_with_file(&app, "WriteFailed");
    let (id, job) = ask(write_failed, source);
    fail(id, job);
    let (update_failed, source) = project_with_file(&app, "UpdateFailed");
    write_notes(&database, update_failed, source, "one");
    let (id, job) = ask(update_failed, source);
    fail(id, job);
    let (writing, source) = project_with_file(&app, "Writing");
    ask(writing, source);
    let (up_to_date, source) = project_with_file(&app, "UpToDate");
    write_notes(&database, up_to_date, source, "one");
    let (outdated, source) = project_with_file(&app, "Outdated");
    write_notes(&database, outdated, source, "one");
    let extra = app.dir().join("More.txt");
    std::fs::write(&extra, "alleles").unwrap();
    database.import_source(&extra, Some(outdated)).unwrap();
    let (updating, source) = project_with_file(&app, "Updating");
    write_notes(&database, updating, source, "one");
    ask(updating, source);

    let read = StudyRead::read(&app.app()).unwrap();
    let status = |project| {
        read.material
            .iter()
            .find(|piece| piece.head().project_id == project)
            .unwrap()
            .status()
    };
    assert_eq!(status(writing), Writing);
    assert_eq!(status(write_failed), WriteFailed);
    assert_eq!(status(up_to_date), UpToDate);
    assert_eq!(
        status(outdated),
        Outdated(study_core::db::Changes { files: 1, notes: 0 })
    );
    assert_eq!(status(updating), Updating);
    assert_eq!(status(update_failed), UpdateFailed);
    let locale = Locale::English;
    assert_eq!(status(write_failed).label(locale), "Couldn't write");
    assert!(status(write_failed).failed() && status(update_failed).failed());
    assert!(!status(updating).failed() && !status(writing).failed());
}
