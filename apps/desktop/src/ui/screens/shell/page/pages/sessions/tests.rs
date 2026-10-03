//! The sessions page, end to end: sending, attaching, deleting and recovering recordings.

use super::ids;
use super::page::{SessionTarget, SessionView, SidePanel};
use crate::testing::TempApp;
use crate::ui::screens::shell::page::testing::{
    click, find, open_offline_shell, render, set_workers, wait_until,
};
use crate::ui::screens::shell::page::workers::WorkersState;
use crate::ui::screens::shell::page::*;
use gpui_kit::{AnyWindowHandle, AppContext as _, TestAppContext};
use study_app::views::{
    Anchor, Block, BlockKind, Document, DocumentMeta, JobKind, JobStatus, JobTarget, MessageRole,
    PartContent,
};
use study_core::db::NewPart;
use study_core::{ErrorKind, Failure, SessionId};
use study_localization::mention_label;

/// The rail button for the projects page, where sessions live.
const PROJECTS_RAIL: usize = Page::Projects as usize;

fn set_composer(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    shell: &gpui_kit::Entity<AppShell>,
    value: &str,
) {
    let value = value.to_owned();
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell
                .sessions
                .composer
                .update(cx, |input, cx| input.set_value(value, window, cx));
        });
    })
    .unwrap();
}

/// Moves the pointer over the element with `id`, which shows what waits for the pointer
/// there, such as a row's buttons.
fn hover(cx: &mut TestAppContext, window: AnyWindowHandle, id: impl Into<gpui_kit::ElementId>) {
    let hidden = find(cx, window, id).expect("the element, maybe hidden until hovered");
    cx.update_window(window, |_, window, cx| {
        use gpui_kit::InputEvent as _;
        window.dispatch_event(
            gpui_kit::MouseMoveEvent {
                position: hidden.bounds().center(),
                pressed_button: None,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn first_message_creates_a_titled_session_and_follow_ups_store_attachments(
    cx: &mut TestAppContext,
) {
    let app = TempApp::new();
    let project = app.database().create_project("Biology").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);

    click(cx, window, PROJECTS_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).sessions;
            state.list_loaded
        })
    });
    // Sessions live under their project; its plus button starts one.
    click(
        cx,
        window,
        (ids::PROJECT_NEW_SESSION, project.id.get() as u64),
    );
    assert_eq!(
        cx.update(|cx| shell.read(cx).sessions.view),
        SessionView::Draft {
            project_id: Some(project.id)
        }
    );

    set_composer(cx, window, &shell, "Photosynthesis recap\nlight reactions");
    click(cx, window, ids::SEND);
    wait_until(cx, |cx| {
        cx.update(|cx| matches!(shell.read(cx).sessions.view, SessionView::Open(_)))
    });

    let database = app.database();
    let sessions = database.list_sessions(project.id).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].title, "Photosynthesis recap");
    let session_id = sessions[0].id;
    assert!(
        cx.update(|cx| shell.read(cx).sessions.composer.read(cx).value().is_empty()),
        "the composer clears after sending"
    );

    let notes = app.dir().join("notes.md");
    std::fs::write(&notes, "# Chlorophyll").unwrap();
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.add_attachments(vec![notes.clone(), notes.clone()], window, cx)
        });
    })
    .unwrap();
    assert_eq!(cx.update(|cx| shell.read(cx).sessions.attachments.len()), 1);
    click(cx, window, ids::SEND);
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).sessions;
            // The note and the file: nothing answers a note that does not ask.
            state.attachments.is_empty() && state.messages.len() == 2
        })
    });

    let messages = database.list_messages(session_id).unwrap();
    assert!(
        messages
            .iter()
            .all(|message| message.role == MessageRole::User)
    );
    let PartContent {
        source_id, name, ..
    } = &messages[1].parts[0].content;
    assert_eq!(name, "notes.md");
    // The file itself lives in the database, filed under the session's project.
    let media = database.list_sources().unwrap();
    assert_eq!(media[0].id, source_id.unwrap());
    assert_eq!(media[0].project_id, Some(project.id));
    assert!(messages[1].parts[0].jobs.is_empty());
    render(cx, window);
}

#[gpui_kit::test]
fn stored_results_render_and_sessions_can_be_deleted(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let audio = app.dir().join("lecture.wav");
    std::fs::write(&audio, b"RIFF").unwrap();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    database
        .post_message(
            session.id,
            MessageRole::User,
            &[
                NewPart::Text("Two recordings".into()),
                NewPart::File(audio.clone()),
                NewPart::File(audio.clone()),
            ],
            &|_, _| true,
        )
        .unwrap();
    let done = database.claim_job(&[JobKind::Extract]).unwrap().unwrap();
    let JobTarget::Source(read) = done.target else {
        panic!("reading targets a source");
    };
    let transcript = Document {
        blocks: vec![Block {
            kind: BlockKind::Segment,
            text: "The cell membrane. ".repeat(40),
            anchor: Anchor::Time {
                start_ms: 0,
                end_ms: 60_000,
            },
        }],
        meta: DocumentMeta {
            extractor: Some(study_core::processing::ExtractorKind::Transcription),
            ..DocumentMeta::default()
        },
    };
    database.save_document(read, &transcript).unwrap();
    database.succeed_job(done.id, &[]).unwrap();
    let failed = database.claim_job(&[JobKind::Extract]).unwrap().unwrap();
    database
        .fail_job(
            failed.id,
            &Failure::new(ErrorKind::Transient, "network error"),
            None,
        )
        .unwrap();

    // Without workers, nothing runs; the page shows what storage says.
    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    let jobs = cx.update(|cx| {
        shell.read(cx).sessions.messages[0]
            .parts
            .iter()
            .flat_map(|part| part.jobs.iter().map(|job| job.status))
            .collect::<Vec<_>>()
    });
    assert_eq!(jobs, [JobStatus::Succeeded, JobStatus::Failed]);

    // The transcript is folded into one line under its file; opening it shows the text,
    // which can be copied, and closing it folds it again.
    let copy = (ids::COPY_JOB, done.id.get() as u64);
    assert!(
        find(cx, window, copy).is_none(),
        "the transcript starts folded"
    );
    click(cx, window, (ids::EXPAND_JOB, done.id.get() as u64));
    assert!(cx.update(|cx| shell.read(cx).sessions.expanded.contains(&done.id)));
    assert!(
        find(cx, window, copy).is_some(),
        "the opened fold shows the text"
    );
    click(cx, window, (ids::EXPAND_JOB, done.id.get() as u64));
    assert!(find(cx, window, copy).is_none(), "the fold closes again");
    click(cx, window, (ids::EXPAND_JOB, done.id.get() as u64));

    // Retrying needs background work, which does not run here. Before the side panel opens:
    // while it slides in, it may cover the button.
    click(cx, window, (ids::RETRY_JOB, failed.id.get() as u64));
    assert_eq!(
        cx.update(|cx| shell.read(cx).sessions.error),
        Some(Message::WorkspaceUnavailable)
    );

    // The recording is one line, its transcript folded under it; its preview button opens
    // the side panel.
    let (part, source) = cx.update(|cx| {
        let part = &shell.read(cx).sessions.messages[0].parts[0];
        let PartContent { source_id, .. } = &part.content;
        (part.id, source_id.unwrap())
    });
    // Its buttons show while the pointer is on its line.
    hover(cx, window, (ids::ATTACHMENT_DETAILS, part.get() as u64));
    click(cx, window, (ids::ATTACHMENT_DETAILS, part.get() as u64));
    assert_eq!(
        cx.update(|cx| shell.read(cx).sessions.panel),
        Some(SidePanel::File(source))
    );

    click(cx, window, ids::DELETE);
    click(cx, window, ids::CONFIRM_DELETE);
    assert!(database.list_sessions(project.id).unwrap().is_empty());
    // Attachments stay in the Library.
    assert_eq!(database.list_sources().unwrap().len(), 2);
    assert_eq!(
        cx.update(|cx| shell.read(cx).sessions.view),
        SessionView::Draft {
            project_id: Some(project.id)
        }
    );
}

#[gpui_kit::test]
fn an_attachment_opens_a_thread_whose_replies_stay_off_the_timeline(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let notes = app.dir().join("notes.md");
    std::fs::write(&notes, "# Chlorophyll").unwrap();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let posted = database
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("Lecture notes".into()), NewPart::File(notes)],
            &|_, _| false,
        )
        .unwrap();
    let root = posted.parts[0].id;

    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    wait_until(cx, |cx| {
        cx.update(|cx| !shell.read(cx).sessions.messages.is_empty())
    });

    // Before anyone replied, the file's line offers a reply on hover; it opens the thread,
    // which starts with the file itself.
    hover(cx, window, (ids::OPEN_THREAD, root.get() as u64));
    click(cx, window, (ids::OPEN_THREAD, root.get() as u64));
    assert_eq!(
        cx.update(|cx| shell.read(cx).sessions.panel),
        Some(SidePanel::Thread(root))
    );
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.thread.showing(root).is_some())
    });
    render(cx, window);

    let value = "Chlorophyll absorbs red and blue light".to_owned();
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell
                .sessions
                .thread
                .composer
                .update(cx, |input, cx| input.set_value(value, window, cx));
        });
    })
    .unwrap();
    click(cx, window, ids::THREAD_SEND);
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).sessions;
            let replies = state
                .thread
                .showing(root)
                .map_or(0, |thread| thread.replies.len());
            // The reply is in the thread; the timeline only counts it.
            replies == 1
                && state.messages.len() == 1
                && state.messages[0].parts[0].thread.replies == 1
        })
    });
    // On the timeline the reply folds into a faint line under the file, which opens it.
    assert!(find(cx, window, (ids::OPEN_THREAD, root.get() as u64)).is_some());
    assert!(cx.update(|cx| {
        shell
            .read(cx)
            .sessions
            .thread
            .composer
            .read(cx)
            .value()
            .is_empty()
    }));
    let thread = database.thread(root).unwrap().expect("a thread");
    assert_eq!(
        thread.replies[0].text(),
        "Chlorophyll absorbs red and blue light"
    );
    render(cx, window);

    click(cx, window, ids::THREAD_CLOSE);
    assert_eq!(cx.update(|cx| shell.read(cx).sessions.panel), None);
}

#[gpui_kit::test]
fn without_projects_the_page_points_to_creating_one(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    cx.update(|cx| shell.update(cx, |shell, _| shell.show_project_session()));
    click(cx, window, ids::GO_TO_PROJECTS);
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Projects);
}

#[gpui_kit::test]
fn a_recording_cut_short_by_a_crash_can_be_sent_or_discarded(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Lecture").unwrap();
    // What a recorder left behind when the app stopped: three saved seconds.
    let recording = database.create_recording(session.id).unwrap();
    for _ in 0..3 {
        database
            .append_recording(recording.id, &[100; 16_000])
            .unwrap();
    }
    let (window, shell) = open_offline_shell(cx, &app, true);

    // The session with the recording opens by itself, offering what to do with it.
    click(cx, window, PROJECTS_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let state = &shell.read(cx).sessions;
            state.view == SessionView::Open(session.id) && state.recording.unfinished.len() == 1
        })
    });
    click(cx, window, ids::SEND_RECORDING);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.recording.unfinished.is_empty())
    });

    let messages = database.list_messages(session.id).unwrap();
    let PartContent {
        source_id, name, ..
    } = &messages[0].parts[0].content;
    assert!(name.ends_with(".wav"), "{name}");
    assert_eq!(messages[0].parts[0].jobs[0].kind, JobKind::Extract);
    let media = database.source(source_id.unwrap()).unwrap().unwrap();
    assert_eq!(media.size_bytes, 44 + 3 * 32_000);
    assert!(database.list_recordings().unwrap().is_empty());

    // Another one is thrown away instead.
    database.create_recording(session.id).unwrap();
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_recordings(cx)));
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.recording.unfinished.len() == 1)
    });
    click(cx, window, ids::DISCARD_RECORDING);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.recording.unfinished.is_empty())
    });
    assert!(database.list_recordings().unwrap().is_empty());
    assert_eq!(database.list_messages(session.id).unwrap().len(), 1);
}

/// Types `typed` into the composer one character at a time, as a keyboard does.
fn type_into_composer(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    shell: &gpui_kit::Entity<AppShell>,
    typed: &str,
) {
    use gpui_kit::EntityInputHandler as _;
    for character in typed.chars() {
        cx.update_window(window, |_, window, cx| {
            let composer = shell.read(cx).sessions.composer.clone();
            composer.update(cx, |input, cx| {
                input.replace_text_in_range(None, &character.to_string(), window, cx)
            });
        })
        .unwrap();
        cx.run_until_parked();
    }
}

#[gpui_kit::test]
fn a_typed_mention_becomes_a_chip_and_is_stored_as_written(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    database
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("The Krebs cycle makes ATP".into())],
            &study_core::db::read_nothing,
        )
        .unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.preferences.language = study_core::Language::Italian;
            shell.open_session(session.id, window, cx);
        })
    })
    .unwrap();
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.messages.len() == 1)
    });

    // A mention being typed stays text; once finished it is a chip, labelled in Italian.
    type_into_composer(cx, window, &shell, "@study spiega");
    let labels = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let composer = shell.read(cx).sessions.composer.read(cx);
            composer
                .tokens()
                .iter()
                .map(|span| span.token().label().to_string())
                .collect::<Vec<_>>()
        })
    };
    type_into_composer(cx, window, &shell, " il ciclo");
    assert_eq!(labels(cx), ["@study"]);

    click(cx, window, ids::SEND);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.messages.len() >= 3)
    });
    let messages = database.list_messages(session.id).unwrap();
    assert_eq!(messages[1].text(), "@study spiega il ciclo");
}

#[test]
fn a_new_session_made_for_a_failed_write_is_deleted_again() -> study_core::Result<()> {
    let app = TempApp::new();
    let project = app.create_project("Biology")?;
    let new = || SessionTarget::New {
        project_id: project.id,
        title: "Cells".into(),
    };

    let failed = new().write(&app, |_| -> study_core::Result<()> {
        Err(study_core::err!("the message was not saved"))
    });
    assert!(failed.is_err());
    assert!(app.all_sessions()?.is_empty());

    let made = new().write(&app, Ok)?;
    let sessions = app.all_sessions()?;
    assert_eq!(sessions.len(), 1);
    assert_eq!(
        (sessions[0].id, sessions[0].title.as_str()),
        (made, "Cells")
    );

    // A session that was already there stays, whatever happens to the write.
    let failed = SessionTarget::Existing(made).write(&app, |_| -> study_core::Result<()> {
        Err(study_core::err!("the message was not saved"))
    });
    assert!(failed.is_err());
    assert_eq!(app.all_sessions()?.len(), 1);
    Ok(())
}

/// Deleting a note asks first, then takes its answer, as the
/// database's foreign keys cascade; the note before it stays.
#[gpui_kit::test]
fn a_note_is_deleted_with_what_hangs_off_it_once_confirmed(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let post = |text: &str| {
        database
            .post_message(
                session.id,
                MessageRole::User,
                &[NewPart::Text(text.into())],
                &|_, _| true,
            )
            .unwrap()
    };
    post("Mitochondria make ATP");
    let asked = post("@study the cell");
    let answer = database.list_messages(session.id).unwrap().pop().unwrap();

    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    assert_eq!(cx.update(|cx| shell.read(cx).sessions.messages.len()), 3);

    // The row's trash button shows on hover; it only asks.
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.sessions.deleting = Some(asked.id);
            cx.notify();
        })
    });
    render(cx, window);
    click(
        cx,
        window,
        (ids::CONFIRM_DELETE_MESSAGE, asked.id.get() as u64),
    );
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.messages.len() == 1)
    });
    assert!(database.message(answer.id).unwrap().is_none());
    assert_eq!(cx.update(|cx| shell.read(cx).sessions.deleting), None);
}

/// Typing `@` and part of a name offers the mentions it could be; Enter inserts the picked
/// one as a chip instead of sending the note, and Escape closes the offer.
#[gpui_kit::test]
fn a_mention_being_typed_is_offered_and_picked_with_the_keyboard(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.database().create_project("Biology").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    click(
        cx,
        window,
        (ids::PROJECT_NEW_SESSION, project.id.get() as u64),
    );
    cx.update_window(window, |_, window, cx| {
        let input = shell.read(cx).sessions.composer.clone();
        input.update(cx, |input, cx| input.focus(window, cx));
    })
    .unwrap();

    cx.simulate_input(window, "@st");
    let offered =
        |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).sessions.picker.is_open());
    assert!(offered(cx));
    cx.simulate_keystrokes(window, "enter");
    let (value, tokens) = cx.update(|cx| {
        let input = shell.read(cx).sessions.composer.read(cx);
        (input.value().to_string(), input.tokens().len())
    });
    assert_eq!((value.as_str(), tokens), ("@study ", 1));
    assert!(!offered(cx));
    assert_eq!(
        cx.update(|cx| shell.read(cx).sessions.view),
        SessionView::Draft {
            project_id: Some(project.id)
        },
        "nothing was sent"
    );

    cx.simulate_input(window, "@");
    assert!(offered(cx));
    // Each offer is a row agents and tests find by its place, named by what it inserts.
    let row = find(cx, window, (ids::MENTION_SUGGESTION, 0_u64)).expect("the first offer");
    let assistant = mention_label(study_core::Mention::Assistant);
    assert!(
        row.label()
            .is_some_and(|label| label.starts_with(&assistant))
    );
    assert_eq!(row.selected(), Some(true));
    cx.simulate_keystrokes(window, "escape");
    assert!(!offered(cx));
}

/// Escape with no mention offered leaves the composer, so the keyboard reaches the page's
/// shortcuts again; the draft stays. The composer and the page that takes dropped files are
/// found by names of their own.
#[gpui_kit::test]
fn escape_leaves_the_composer(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.database().create_project("Biology").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    click(
        cx,
        window,
        (ids::PROJECT_NEW_SESSION, project.id.get() as u64),
    );
    let drop = find(cx, window, ids::DROP_TARGET).expect("the page takes dropped files");
    assert_eq!(
        drop.label(),
        Some(text(Locale::English, Message::DropFilesToAttach))
    );
    click(cx, window, ids::COMPOSER);
    let focused = |cx: &mut TestAppContext| {
        cx.update_window(window, |_, window, cx| {
            let input = shell.read(cx).sessions.composer.read(cx);
            gpui_kit::Focusable::focus_handle(input, cx).is_focused(window)
        })
        .unwrap()
    };
    assert!(focused(cx));
    cx.simulate_input(window, "draft");
    cx.simulate_keystrokes(window, "escape");
    assert!(!focused(cx));
    let value = cx.update(|cx| {
        shell
            .read(cx)
            .sessions
            .composer
            .read(cx)
            .value()
            .to_string()
    });
    assert_eq!(value, "draft");
}

/// A note left half written stays with its session: another one opens with an empty
/// composer, and coming back brings the note (and its mentions, as chips) back.
#[gpui_kit::test]
fn an_unsent_note_stays_with_its_session(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let cells = database.create_session(project.id, "Cells").unwrap();
    let genes = database.create_session(project.id, "Genes").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    let open = |cx: &mut TestAppContext, id| {
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| shell.open_session(id, window, cx))
        })
        .unwrap();
    };
    let composer = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let input = shell.read(cx).sessions.composer.read(cx);
            (input.value().to_string(), input.tokens().len())
        })
    };

    open(cx, cells.id);
    set_composer(cx, window, &shell, "mitochondria @study later");
    open(cx, genes.id);
    assert_eq!(composer(cx), (String::new(), 0));
    set_composer(cx, window, &shell, "alleles");
    open(cx, cells.id);
    assert_eq!(composer(cx), ("mitochondria @study later".to_string(), 1));
    open(cx, genes.id);
    assert_eq!(composer(cx).0, "alleles");
}

/// A session deleted elsewhere takes what was being written in it along, rather than leaving
/// it to become a new session's draft.
#[gpui_kit::test]
fn an_unsent_note_goes_with_a_session_deleted_elsewhere(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let cells = database.create_session(project.id, "Cells").unwrap();
    let genes = database.create_session(project.id, "Genes").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    let composer = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            shell
                .read(cx)
                .sessions
                .composer
                .read(cx)
                .value()
                .to_string()
        })
    };

    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.start_draft(Some(project.id), window, cx);
        })
    })
    .unwrap();
    set_composer(cx, window, &shell, "a new idea");
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| shell.open_session(cells.id, window, cx))
    })
    .unwrap();
    set_composer(cx, window, &shell, "mitochondria");
    assert!(database.delete_session(cells.id).unwrap());
    shell.update(cx, |shell, cx| shell.load_session_list(cx));
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.view.session().is_none())
    });
    render(cx, window);
    assert!(cx.update(|cx| shell.read(cx).sessions.messages_for.is_none()));
    // The draft shows what was written for it, not the deleted session's note.
    assert_eq!(composer(cx), "a new idea");
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| shell.open_session(genes.id, window, cx))
    })
    .unwrap();
    assert_eq!(composer(cx), "");
}

/// Pasting an image attaches it, saved as a file named for when it was pasted; pasting
/// text leaves the text box to paste it.
#[gpui_kit::test]
fn a_pasted_image_is_attached(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.database().create_project("Biology").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    click(
        cx,
        window,
        (ids::PROJECT_NEW_SESSION, project.id.get() as u64),
    );
    cx.update_window(window, |_, window, cx| {
        let input = shell.read(cx).sessions.composer.clone();
        input.update(cx, |input, cx| input.focus(window, cx));
    })
    .unwrap();
    let attached =
        |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).sessions.attachments.clone());

    cx.update(|cx| cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string("just text".into())));
    cx.simulate_keystrokes(window, "secondary-v");
    assert!(attached(cx).is_empty());

    let png =
        gpui_kit::Image::from_bytes(gpui_kit::ImageFormat::Png, b"\x89PNG\r\n\x1a\n".to_vec());
    cx.update(|cx| cx.write_to_clipboard(gpui_kit::ClipboardItem::new_image(&png)));
    cx.simulate_keystrokes(window, "secondary-v");
    let attached = attached(cx);
    assert_eq!(attached.len(), 1);
    let name = attached[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(
        name.starts_with("Pasted image ") && name.ends_with(".png"),
        "{name}"
    );
    assert_eq!(std::fs::read(&attached[0]).unwrap(), b"\x89PNG\r\n\x1a\n");
}

/// A note's words copy from the button that shows while it is hovered.
#[gpui_kit::test]
fn a_note_copies_what_it_says(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let note = database
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("Mitochondria make ATP".into())],
            &|_, _| true,
        )
        .unwrap();
    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    let _ = &shell;
    let copy = (ids::COPY_MESSAGE, note.id.get() as u64);
    hover(cx, window, copy);
    click(cx, window, copy);
    let copied = cx.update(|cx| cx.read_from_clipboard().and_then(|item| item.text()));
    assert_eq!(copied.as_deref(), Some("Mitochondria make ATP"));
}

/// Far up a long transcript, a button leads back to the latest notes; at the end it goes.
#[gpui_kit::test]
fn a_long_transcript_leads_back_to_its_latest_notes(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    for note in 0..60 {
        database
            .post_message(
                session.id,
                MessageRole::User,
                &[NewPart::Text(format!("Note {note} about the cell"))],
                &|_, _| true,
            )
            .unwrap();
    }
    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    render(cx, window);
    render(cx, window);
    assert!(
        find(cx, window, ids::JUMP_TO_LATEST).is_none(),
        "it opens at the end"
    );

    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell
                .sessions
                .scroll
                .set_offset(gpui_kit::point(gpui_kit::px(0.), gpui_kit::px(0.)));
            cx.notify();
        })
    });
    render(cx, window);
    click(cx, window, ids::JUMP_TO_LATEST);
    render(cx, window);
    render(cx, window);
    assert!(find(cx, window, ids::JUMP_TO_LATEST).is_none());
}

/// A citation opens its file beside the conversation at the cited passage, which comes
/// first, with a way back to the top.
#[gpui_kit::test]
fn a_citation_opens_its_file_at_the_passage(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let audio = app.dir().join("lecture.wav");
    std::fs::write(&audio, b"RIFF").unwrap();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let note = database
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::File(audio)],
            &|_, _| true,
        )
        .unwrap();
    let done = database.claim_job(&[JobKind::Extract]).unwrap().unwrap();
    let JobTarget::Source(source) = done.target else {
        panic!("reading targets a source");
    };
    let blocks = (0..8)
        .map(|n| Block {
            kind: BlockKind::Segment,
            text: format!("Minute {n} of the lecture."),
            anchor: Anchor::Time {
                start_ms: n * 60_000,
                end_ms: (n + 1) * 60_000,
            },
        })
        .collect();
    database
        .save_document(
            source,
            &Document {
                blocks,
                meta: DocumentMeta::default(),
            },
        )
        .unwrap();
    database.succeed_job(done.id, &[]).unwrap();
    let _ = note;

    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.open_cited(
                source,
                "lecture.mp3".into(),
                Anchor::Time {
                    start_ms: 300_000,
                    end_ms: 360_000,
                },
                window,
                cx,
            )
        })
    })
    .unwrap();
    render(cx, window);
    let block = |cx: &mut TestAppContext, ordinal: u64| {
        find(
            cx,
            window,
            (ids::DETAIL_CORRECT, (source.get() as u64) << 32 | ordinal),
        )
        .is_some()
    };
    // Minute 5 is cited: it shows, after minute 4, and the start does not.
    assert!(block(cx, 5) && block(cx, 4));
    assert!(!block(cx, 0));
    // Show earlier text is there; the panel slides in, so the test does what it does.
    assert!(find(cx, window, (ids::DETAIL_FROM_START, source.get() as u64)).is_some());
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.sessions.cited_earlier = true;
            cx.notify();
        })
    });
    assert!(block(cx, 0));
}

/// A session opened by itself for its unfinished recording keeps what was being written
/// elsewhere where it was written, rather than taking it into the composer.
#[gpui_kit::test]
fn a_session_opened_for_its_recording_leaves_the_draft_behind(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Lecture").unwrap();
    database.create_recording(session.id).unwrap();
    let (window, shell) = open_offline_shell(cx, &app, false);
    let composer = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            shell
                .read(cx)
                .sessions
                .composer
                .read(cx)
                .value()
                .to_string()
        })
    };
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.start_draft(Some(project.id), window, cx)
        })
    })
    .unwrap();
    set_composer(cx, window, &shell, "a new idea");

    click(cx, window, PROJECTS_RAIL);
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.view == SessionView::Open(session.id))
    });
    render(cx, window);
    assert_eq!(composer(cx), "");
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.start_draft(Some(project.id), window, cx)
        })
    })
    .unwrap();
    assert_eq!(composer(cx), "a new idea");
}

/// Work on a session that ends after another was opened leaves the one on screen alone,
/// rather than loading the first session's notes into it.
#[gpui_kit::test]
fn work_ending_in_a_session_left_meanwhile_does_not_reload_it(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let cells = database.create_session(project.id, "Cells").unwrap();
    let genes = database.create_session(project.id, "Genes").unwrap();
    for (session, note) in [(cells.id, "mitochondria"), (genes.id, "alleles")] {
        database
            .post_message(
                session,
                MessageRole::User,
                &[NewPart::Text(note.into())],
                &study_core::db::read_nothing,
            )
            .unwrap();
    }
    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    for id in [cells.id, genes.id] {
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| shell.open_session(id, window, cx))
        })
        .unwrap();
        wait_until(cx, |cx| {
            cx.update(|cx| shell.read(cx).sessions.messages_for == Some(id))
        });
    }

    // What a reply or a deletion begun in Cells asks for once it ends.
    cx.update(|cx| shell.update(cx, |shell, cx| shell.reload_session(cells.id, cx)));
    wait_until(cx, |cx| {
        cx.update(|cx| !shell.read(cx).sessions.messages_loading)
    });
    let state = cx.update(|cx| {
        let state = &shell.read(cx).sessions;
        (state.messages_for, state.messages.len())
    });
    assert_eq!(state, (Some(genes.id), 1));
}

/// A failure that ends after the user opened another session stays off that session's page.
#[gpui_kit::test]
fn a_late_failure_stays_with_the_session_it_was_for(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let cells = database.create_session(project.id, "Cells").unwrap();
    let genes = database.create_session(project.id, "Genes").unwrap();
    // The page thinks background work is ready, but nothing runs, so naming fails.
    let (window, shell) = open_offline_shell(cx, &app, false);
    set_workers(cx, &shell, WorkersState::Ready);
    click(cx, window, PROJECTS_RAIL);
    let open = |cx: &mut TestAppContext, id| {
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| shell.open_session(id, window, cx))
        })
        .unwrap();
    };
    let titled = |cx: &mut TestAppContext, id| {
        wait_until(cx, |cx| {
            cx.update(|cx| !shell.read(cx).sessions.titling.contains(&id))
        });
        cx.update(|cx| shell.read(cx).sessions.error)
    };

    open(cx, cells.id);
    cx.update(|cx| shell.update(cx, |shell, cx| shell.regenerate_title(cells.id, cx)));
    assert_eq!(titled(cx, cells.id), Some(Message::TitleGenerationError));

    cx.update(|cx| shell.update(cx, |shell, cx| shell.regenerate_title(cells.id, cx)));
    open(cx, genes.id);
    assert_eq!(titled(cx, cells.id), None);
}

/// A send that ends after a draft in another project was opened empties the composer that
/// draft shares, so Enter does not post the same note again, and leaves the page on it.
#[gpui_kit::test]
fn a_send_ending_in_another_projects_draft_empties_the_composer(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let biology = database.create_project("Biology").unwrap();
    let chemistry = database.create_project("Chemistry").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.start_draft(Some(biology.id), window, cx)
        })
    })
    .unwrap();
    set_composer(cx, window, &shell, "Photosynthesis recap");

    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.send_message(window, cx);
            shell.start_session_in(chemistry.id, window, cx);
        })
    })
    .unwrap();
    wait_until(cx, |cx| cx.update(|cx| !shell.read(cx).sessions.sending));

    assert_eq!(database.list_sessions(biology.id).unwrap().len(), 1);
    let (view, composer) = cx.update(|cx| {
        let state = &shell.read(cx).sessions;
        (state.view, state.composer.read(cx).value().to_string())
    });
    assert_eq!(
        view,
        SessionView::Draft {
            project_id: Some(chemistry.id)
        }
    );
    assert_eq!(composer, "");
}

/// A send that fails after the user opened another session says nothing on that one's page.
#[gpui_kit::test]
fn a_failed_send_stays_off_the_session_opened_meanwhile(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let cells = database.create_session(project.id, "Cells").unwrap();
    let genes = database.create_session(project.id, "Genes").unwrap();
    let (window, shell) = open_offline_shell(cx, &app, true);
    click(cx, window, PROJECTS_RAIL);
    let send_then_open = |cx: &mut TestAppContext, then: Option<SessionId>| {
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| {
                shell.send_message(window, cx);
                if let Some(id) = then {
                    shell.open_session(id, window, cx);
                }
            })
        })
        .unwrap();
        wait_until(cx, |cx| cx.update(|cx| !shell.read(cx).sessions.sending));
        cx.update(|cx| shell.read(cx).sessions.error)
    };
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| shell.open_session(cells.id, window, cx))
    })
    .unwrap();
    // Gone from the database, so posting to it fails.
    assert!(database.delete_session(cells.id).unwrap());

    set_composer(cx, window, &shell, "mitochondria");
    assert_eq!(send_then_open(cx, None), Some(Message::SendMessageError));
    assert_eq!(send_then_open(cx, Some(genes.id)), None);
}

/// The keyboard walks the notebook in reading order: from the composer, Shift+Tab goes
/// back through the work folded under a file, the file's buttons and the note's actions,
/// and Tab comes forward to the composer again; neither indents the note being written.
#[gpui_kit::test]
fn the_keyboard_walks_the_notebook_in_reading_order(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let audio = app.dir().join("lecture.wav");
    std::fs::write(&audio, b"RIFF").unwrap();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let note = database
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("Mitochondria".into()), NewPart::File(audio)],
            &|_, _| true,
        )
        .unwrap();
    let done = database.claim_job(&[JobKind::Extract]).unwrap().unwrap();
    let JobTarget::Source(read) = done.target else {
        panic!("reading targets a source");
    };
    let transcript = Document {
        blocks: vec![Block {
            kind: BlockKind::Segment,
            text: "The cell membrane.".into(),
            anchor: Anchor::Time {
                start_ms: 0,
                end_ms: 60_000,
            },
        }],
        meta: DocumentMeta::default(),
    };
    database.save_document(read, &transcript).unwrap();
    database.succeed_job(done.id, &[]).unwrap();

    let (window, shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    let part = cx.update(|cx| shell.read(cx).sessions.messages[0].parts[0].id);
    click(cx, window, ids::COMPOSER);

    // The innermost element holding the keyboard, by its own id.
    let focused = |cx: &mut TestAppContext| -> Option<gpui_kit::ElementId> {
        cx.update_window(window, |_, window, cx| {
            gpui_kit::test::TestWindowExt::render_frame(window, cx);
            gpui_kit::base::test_support::snapshots(window)
                .into_iter()
                // Only what tracks its focus says whether it has it.
                .filter(|element| format!("{element:?}").contains("focused: Some(true)"))
                .max_by_key(|element| element.path().len())
                .and_then(|element| element.path().last().cloned())
        })
        .unwrap()
    };
    let composer = focused(cx);
    assert!(composer.is_some(), "the composer has the keyboard");
    let note_id = note.id.get() as u64;
    let part_id = part.get() as u64;
    let backwards: Vec<gpui_kit::ElementId> = vec![
        (ids::EXPAND_JOB, done.id.get() as u64).into(),
        (ids::ATTACHMENT_DETAILS, part_id).into(),
        (ids::OPEN_ATTACHMENT, part_id).into(),
        (ids::OPEN_THREAD, part_id).into(),
        (ids::DELETE_MESSAGE, note_id).into(),
        (ids::COPY_MESSAGE, note_id).into(),
    ];
    for expected in &backwards {
        cx.simulate_keystrokes(window, "shift-tab");
        assert_eq!(focused(cx).as_ref(), Some(expected));
    }
    for expected in backwards.iter().rev().skip(1) {
        cx.simulate_keystrokes(window, "tab");
        assert_eq!(focused(cx).as_ref(), Some(expected));
    }
    cx.simulate_keystrokes(window, "tab");
    assert_eq!(focused(cx), composer, "Tab comes back to the composer");
    let written = cx.update(|cx| {
        shell
            .read(cx)
            .sessions
            .composer
            .read(cx)
            .value()
            .to_string()
    });
    assert_eq!(written, "", "tabbing indents nothing");
}

/// A session holding one note, opened on the page.
fn open_note(
    cx: &mut TestAppContext,
    app: &TempApp,
    parts: &[NewPart],
) -> (
    AnyWindowHandle,
    gpui_kit::Entity<AppShell>,
    study_core::MessageId,
) {
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let note = database
        .post_message(session.id, MessageRole::User, parts, &|_, _| true)
        .unwrap();
    // Offline: model work waits for a sign-in, so what is queued stays unfinished.
    let (window, shell) = open_offline_shell(cx, app, true);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    (window, shell, note.id)
}

fn text_note(words: &str) -> Vec<NewPart> {
    vec![NewPart::Text(words.into())]
}

/// Whether the element with `id` is on the page.
fn shown(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    id: impl Into<gpui_kit::ElementId>,
) -> bool {
    find(cx, window, id).is_some()
}

/// The switcher shows once a note has two versions, steps between the finished ones and
/// stops at each end.
#[gpui_kit::test]
fn the_switcher_steps_between_the_versions_of_a_note(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell, note) = open_note(cx, &app, &text_note("Mitochondria make ATP"));
    let database = app.database();
    let mid = note.get() as u64;
    // One version: nothing to switch.
    assert!(!shown(cx, window, (ids::VERSION_SWITCHER, mid)));

    database
        .edit_message(note, "Mitochondria make most ATP")
        .unwrap();
    // The page reads the session again after any change.
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            let session = shell.sessions.session_id().unwrap();
            shell.reload_session(session, cx);
        })
    });
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.messages[0].versions.len() == 2)
    });
    render(cx, window);
    assert!(shown(cx, window, (ids::VERSION_SWITCHER, mid)));
    let active = |cx: &mut TestAppContext| {
        cx.update(|cx| shell.read(cx).sessions.messages[0].text().to_owned())
    };
    assert_eq!(active(cx), "Mitochondria make most ATP");

    click(cx, window, (ids::VERSION_PREVIOUS, mid));
    wait_until(cx, |cx| active(cx) == "Mitochondria make ATP");
    assert_eq!(
        database.message(note).unwrap().unwrap().text(),
        "Mitochondria make ATP"
    );
    click(cx, window, (ids::VERSION_NEXT, mid));
    wait_until(cx, |cx| active(cx) == "Mitochondria make most ATP");
}

/// Editing in place saves the words as a new version; empty words cannot be saved, and words
/// left as they were add nothing.
#[gpui_kit::test]
fn an_edit_saves_a_version(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell, note) = open_note(cx, &app, &text_note("Mitochondria make ATP"));
    let database = app.database();
    let mid = note.get() as u64;
    let versions = || database.message(note).unwrap().unwrap().versions.len();
    let set_edit = |cx: &mut TestAppContext, words: &str| {
        let words = words.to_owned();
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| {
                shell
                    .sessions
                    .versions
                    .edit_field
                    .update(cx, |field, cx| field.set_value(words, window, cx));
            });
        })
        .unwrap();
    };

    hover(cx, window, (ids::EDIT_MESSAGE, mid));
    click(cx, window, (ids::EDIT_MESSAGE, mid));
    assert!(shown(cx, window, (ids::SAVE_EDIT, mid)));

    // Words left as they were: nothing is added, and the page says so.
    click(cx, window, (ids::SAVE_EDIT, mid));
    wait_until(cx, |cx| {
        render(cx, window);
        shown(cx, window, (ids::VERSION_NOTICE, mid))
    });
    assert_eq!(versions(), 1);
    assert!(!shown(cx, window, (ids::SAVE_EDIT, mid)));

    // Nothing written: Save does nothing.
    hover(cx, window, (ids::EDIT_MESSAGE, mid));
    click(cx, window, (ids::EDIT_MESSAGE, mid));
    set_edit(cx, "   ");
    render(cx, window);
    click(cx, window, (ids::SAVE_EDIT, mid));
    assert_eq!(versions(), 1);
    assert!(shown(cx, window, (ids::SAVE_EDIT, mid)));

    set_edit(cx, "Mitochondria make most ATP");
    render(cx, window);
    click(cx, window, (ids::SAVE_EDIT, mid));
    wait_until(cx, |_| versions() == 2);
    let saved = database.message(note).unwrap().unwrap();
    assert_eq!(saved.text(), "Mitochondria make most ATP");
    assert_eq!(
        saved.versions[1].origin,
        study_app::views::VersionOrigin::Edited
    );
    render(cx, window);
    assert!(!shown(cx, window, (ids::SAVE_EDIT, mid)));
}

/// AI edit offers rewrites from a menu; choosing one queues a version being written, which
/// can only be stopped or deleted, and a second request while it is written says so.
#[gpui_kit::test]
fn an_ai_edit_queues_a_version_and_a_second_one_is_refused_aloud(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell, note) = open_note(cx, &app, &text_note("Mitochondria make ATP"));
    let database = app.database();
    let mid = note.get() as u64;

    hover(cx, window, (ids::AI_EDIT, mid));
    click(cx, window, (ids::AI_EDIT, mid));
    assert!(shown(cx, window, (ids::AI_IMPROVE, mid)));
    assert!(shown(cx, window, (ids::AI_SUMMARIZE, mid)));
    click(cx, window, (ids::AI_IMPROVE, mid));
    wait_until(cx, |_| {
        database
            .message(note)
            .unwrap()
            .unwrap()
            .unfinished()
            .is_some()
    });
    let queued = database.message(note).unwrap().unwrap();
    assert_eq!(queued.versions.len(), 2);
    assert_eq!(
        queued.versions[1].origin,
        study_app::views::VersionOrigin::Improve
    );
    // The menu closed, and the entry now offers only what a version being written allows.
    render(cx, window);
    assert!(!shown(cx, window, (ids::AI_IMPROVE, mid)));
    assert!(shown(cx, window, (ids::STOP_VERSION, mid)));
    assert!(shown(cx, window, (ids::DELETE_MESSAGE, mid)));
    assert!(!shown(cx, window, (ids::EDIT_MESSAGE, mid)));
    assert!(!shown(cx, window, (ids::AI_EDIT, mid)));

    // Another request meanwhile gets a visible answer, not silence.
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.ask_version(
                note,
                move |app| app.rewrite_message(note, &study_app::views::Rewrite::Summarize),
                cx,
            )
        })
    });
    wait_until(cx, |cx| {
        render(cx, window);
        shown(cx, window, (ids::VERSION_NOTICE, mid))
    });
    assert_eq!(database.message(note).unwrap().unwrap().versions.len(), 2);
}

/// Space belongs to the instruction field and does not close the menu, an empty instruction
/// runs nothing, and a written one queues a version and closes the menu.
#[gpui_kit::test]
fn the_instruction_field_takes_space_and_enter_without_closing_the_menu(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell, note) = open_note(cx, &app, &text_note("Mitochondria make ATP"));
    let database = app.database();
    let mid = note.get() as u64;
    cx.update(crate::app::desktop::bind_prompt_field);

    hover(cx, window, (ids::AI_EDIT, mid));
    click(cx, window, (ids::AI_EDIT, mid));
    click(cx, window, (ids::AI_INSTRUCTION, mid));
    cx.simulate_input(window, "a");
    cx.simulate_keystrokes(window, "space");
    cx.simulate_input(window, "b");
    render(cx, window);
    assert!(
        shown(cx, window, (ids::AI_IMPROVE, mid)),
        "space kept the menu open"
    );
    let value = cx.update(|cx| {
        shell
            .read(cx)
            .sessions
            .versions
            .instruction
            .read(cx)
            .value()
            .to_string()
    });
    assert_eq!(value, "a b");

    // Enter on an empty instruction does nothing and keeps the menu open.
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell
                .sessions
                .versions
                .instruction
                .update(cx, |field, cx| field.set_value("", window, cx));
        });
    })
    .unwrap();
    cx.simulate_keystrokes(window, "enter");
    render(cx, window);
    assert!(
        shown(cx, window, (ids::AI_IMPROVE, mid)),
        "an empty Enter kept the menu open"
    );
    assert_eq!(database.message(note).unwrap().unwrap().versions.len(), 1);

    cx.simulate_input(window, "shorter");
    cx.simulate_keystrokes(window, "enter");
    wait_until(cx, |_| {
        database.message(note).unwrap().unwrap().versions.len() == 2
    });
    render(cx, window);
    assert!(
        !shown(cx, window, (ids::AI_IMPROVE, mid)),
        "running closed the menu"
    );
}

/// After a click on the switcher the arrow keys keep stepping, and the AI menu hands focus
/// back to its button when it closes.
#[gpui_kit::test]
fn keys_step_versions_after_a_click_and_the_menu_returns_focus(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let (window, shell, note) = open_note(cx, &app, &text_note("Mitochondria make ATP"));
    let database = app.database();
    let mid = note.get() as u64;
    database
        .edit_message(note, "Mitochondria make most ATP")
        .unwrap();
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            let session = shell.sessions.session_id().unwrap();
            shell.reload_session(session, cx);
        })
    });
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).sessions.messages[0].versions.len() == 2)
    });
    render(cx, window);
    let active = |cx: &mut TestAppContext| {
        cx.update(|cx| shell.read(cx).sessions.messages[0].text().to_owned())
    };
    click(cx, window, (ids::VERSION_PREVIOUS, mid));
    wait_until(cx, |cx| active(cx) == "Mitochondria make ATP");
    cx.simulate_keystrokes(window, "right");
    wait_until(cx, |cx| active(cx) == "Mitochondria make most ATP");

    // The AI menu: Escape returns focus to the button's slot.
    hover(cx, window, (ids::AI_EDIT, mid));
    click(cx, window, (ids::AI_EDIT, mid));
    assert!(shown(cx, window, (ids::AI_IMPROVE, mid)));
    cx.simulate_keystrokes(window, "escape");
    render(cx, window);
    assert!(!shown(cx, window, (ids::AI_IMPROVE, mid)));
    let back = cx.update_window(window, |_, window, cx| {
        shell
            .read(cx)
            .sessions
            .versions
            .focus
            .get(&note)
            .is_some_and(|focus| focus.ai.is_focused(window))
    });
    assert!(back.unwrap(), "focus returned to the AI edit button");
}

/// What each kind of entry offers on its floating bar.
#[gpui_kit::test]
fn the_bar_offers_what_each_entry_can_do(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let database = app.database();
    let project = database.create_project("Biology").unwrap();
    let session = database.create_session(project.id, "Cells").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("slides.txt");
    std::fs::write(&file, "slides").unwrap();
    let typed = database
        .post_message(
            session.id,
            MessageRole::User,
            &text_note("Mitochondria make ATP"),
            &|_, _| true,
        )
        .unwrap();
    let file_only = database
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::File(file)],
            &|_, _| true,
        )
        .unwrap();
    database
        .post_message(
            session.id,
            MessageRole::User,
            &text_note("@study what makes ATP?"),
            &|_, _| true,
        )
        .unwrap();
    let answer = database.list_messages(session.id).unwrap().pop().unwrap();
    let job = database
        .claim_job(&[JobKind::Reply])
        .unwrap()
        .expect("the reply job");
    let first = database
        .begin_version(answer.id, JobKind::Reply)
        .unwrap()
        .unwrap();
    database
        .finish_version(first.id, "Mitochondria [1].", &[])
        .unwrap();
    database.succeed_job(job.id, &[]).unwrap();

    let (window, _shell) = open_offline_shell(cx, &app, false);
    click(cx, window, PROJECTS_RAIL);
    click(cx, window, (ids::SESSION, session.id.get() as u64));
    let has = |cx: &mut TestAppContext, id: &'static str, message: study_core::MessageId| {
        shown(cx, window, (id, message.get() as u64))
    };
    for id in [
        ids::AI_EDIT,
        ids::EDIT_MESSAGE,
        ids::COPY_MESSAGE,
        ids::DELETE_MESSAGE,
    ] {
        assert!(has(cx, id, typed.id), "a typed note offers {id}");
    }
    assert!(!has(cx, ids::REANSWER, typed.id));

    // A file nothing was read from has no words to rewrite, edit or copy.
    assert!(has(cx, ids::DELETE_MESSAGE, file_only.id));
    for id in [ids::AI_EDIT, ids::EDIT_MESSAGE, ids::COPY_MESSAGE] {
        assert!(
            !has(cx, id, file_only.id),
            "a bare file does not offer {id}"
        );
    }

    for id in [
        ids::AI_EDIT,
        ids::REANSWER,
        ids::EDIT_MESSAGE,
        ids::COPY_MESSAGE,
        ids::DELETE_MESSAGE,
    ] {
        assert!(has(cx, id, answer.id), "a finished answer offers {id}");
    }
}
