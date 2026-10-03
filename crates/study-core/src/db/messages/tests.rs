//! Posting, listing, answering and deleting messages.

use crate::Result;
use crate::db::{
    Database, JobTarget, MessageRole, MessageStatus, NewPart, PartContent, Place, ThreadSummary,
    read_nothing,
};
use crate::{Anchor, Citation, JobKind, JobStatus, ProjectId, SessionId, SourceKind};
use std::fs;
use std::path::Path;

fn text(value: &str) -> NewPart {
    NewPart::Text(value.to_owned())
}

fn read_everything(_: SourceKind, _: &str) -> bool {
    true
}

/// A project, Biology, with a session titled Cells.
fn cells(db: &Database) -> Result<(ProjectId, SessionId)> {
    let project = db.create_project("Biology")?;
    let session = db.create_session(project.id, "Cells")?;
    Ok((project.id, session.id))
}

/// A file in `dir` holding `contents`, as a part to attach.
fn attach(dir: &Path, name: &str, contents: &str) -> Result<NewPart> {
    let path = dir.join(name);
    fs::write(&path, contents)?;
    Ok(NewPart::File(path))
}

#[test]
fn messages_store_text_and_files_in_order_with_their_jobs() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (project, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;

    let posted = db.post_message(
        session,
        MessageRole::User,
        &[text("  Summarize this  "), notes],
        &read_everything,
    )?;

    assert_eq!(posted.status, MessageStatus::Complete);
    assert_eq!(
        posted.parts[0].content,
        PartContent::Text("Summarize this".into())
    );
    let PartContent::Source {
        source_id, name, ..
    } = &posted.parts[1].content
    else {
        panic!("expected a source part");
    };
    assert_eq!(name, "notes.txt");
    assert_eq!(posted.parts[1].jobs[0].status, crate::JobStatus::Queued);

    let sources = db.list_sources()?;
    assert_eq!(sources[0].id, source_id.unwrap());
    assert_eq!(sources[0].project_id, Some(project));
    assert_eq!(sources[0].origin, crate::SourceOrigin::Attachment);
    assert_eq!(sources[0].kind, crate::SourceKind::Text);

    assert_eq!(db.list_messages(session)?[0], posted);
    Ok(())
}

#[test]
fn a_note_gets_no_answer_but_the_session_is_named_once_its_files_are_read() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let session = db.create_untitled_session(project.id, "New session")?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    db.post_message(
        session.id,
        MessageRole::User,
        &[text("Mitochondria power the cell."), notes],
        &read_everything,
    )?;
    assert_eq!(db.list_messages(session.id)?.len(), 1);
    let titles = db.jobs_for(JobTarget::Session(session.id))?;
    assert_eq!(
        titles
            .iter()
            .map(|job| (job.kind, job.status))
            .collect::<Vec<_>>(),
        [(JobKind::Title, JobStatus::Blocked)]
    );
    Ok(())
}

/// Deleting a note takes everything that hangs off it, enforced by the database's foreign
/// keys: its answer, their citations, threads and jobs. The files it attached stay in the
/// Library, and so does the project's material.
#[test]
fn deleting_a_note_cascades_to_its_answer_threads_and_jobs() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (project, session) = cells(&db)?;
    let lecture = attach(dir.path(), "lecture.txt", "the Krebs cycle")?;
    let note = db.post_message(
        session,
        MessageRole::User,
        &[text("Lecture 4"), lecture],
        &read_everything,
    )?;
    let root = note.parts[1].id;
    let reply = db.post_message(
        Place::Thread(root),
        MessageRole::User,
        &[text("starts at 12:30")],
        &read_nothing,
    )?;
    let asked = db.post_message(
        session,
        MessageRole::User,
        &[text("@study the cycle")],
        &read_everything,
    )?;
    let answer = db.list_messages(session)?.pop().expect("the answer");
    let source = db.list_sources()?[0].id;
    let (studied, _) = db.request_update(project, crate::ArtifactKind::Diagram, &[source])?;

    // The answer alone takes its job.
    assert!(db.delete_message(answer.id)?);
    assert!(db.jobs_for(JobTarget::Message(answer.id))?.is_empty());
    assert_eq!(db.list_messages(session)?.len(), 2);

    // The note takes its thread; its file and the project's material stay.
    assert!(db.delete_message(note.id)?);
    assert!(db.thread(root)?.is_none());
    assert!(db.message(reply.id)?.is_none());
    assert_eq!(db.list_sources()?.len(), 1);
    assert!(db.artifact(studied)?.is_some());

    // The session takes its messages, and the material stays.
    assert!(db.delete_session(session)?);
    assert!(db.message(asked.id)?.is_none());
    assert!(db.artifact(studied)?.is_some());
    Ok(())
}

#[test]
fn mentioning_the_assistant_gets_an_answer_written_once_the_files_are_read() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    let question = db.post_message(
        session,
        MessageRole::User,
        &[text("@study what powers the cell?"), notes],
        &read_everything,
    )?;
    let PartContent::Source { source_id, .. } = question.parts[1].content else {
        panic!("expected a source part");
    };

    let messages = db.list_messages(session)?;
    let answer = &messages[1];
    assert_eq!(
        (answer.role, answer.status, answer.reply_to),
        (
            MessageRole::Assistant,
            MessageStatus::Pending,
            Some(question.id)
        )
    );
    let reply = answer.reply.as_ref().expect("a reply job");
    assert_eq!(reply.status, JobStatus::Blocked);

    assert!(db.begin_reply(answer.id)?);
    let citation = Citation {
        marker: 1,
        source_id,
        source_name: "notes.txt".into(),
        anchor: Anchor::Text {
            line_start: 1,
            line_end: 1,
            start: 0,
            end: 12,
        },
        quote: "mitochondria".into(),
    };
    assert!(db.finish_reply(
        answer.id,
        "Mitochondria [1].",
        std::slice::from_ref(&citation)
    )?);
    let answer = db.message(answer.id)?.unwrap();
    assert_eq!(answer.status, MessageStatus::Complete);
    assert_eq!(
        answer.parts[0].content,
        PartContent::Text("Mitochondria [1].".into())
    );
    assert_eq!(answer.citations, std::slice::from_ref(&citation));

    // A citation outlives its source.
    db.delete_source(source_id.unwrap())?;
    let kept = &db.message(answer.id)?.unwrap().citations[0];
    assert_eq!((kept.source_id, &kept.quote), (None, &citation.quote));
    Ok(())
}

#[test]
fn a_source_deleted_while_the_answer_is_written_is_cited_without_it() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    let question = db.post_message(
        session,
        MessageRole::User,
        &[text("@study what powers the cell?"), notes],
        &read_everything,
    )?;
    let PartContent::Source { source_id, .. } = question.parts[1].content else {
        panic!("expected a source part");
    };
    let answer = db.list_messages(session)?[1].id;
    assert!(db.begin_reply(answer)?);
    // The excerpts were read; the source goes before the model answers.
    let citation = Citation {
        marker: 1,
        source_id,
        source_name: "notes.txt".into(),
        anchor: Anchor::Text {
            line_start: 1,
            line_end: 1,
            start: 0,
            end: 12,
        },
        quote: "mitochondria".into(),
    };
    assert!(db.delete_source(source_id.unwrap())?);

    assert!(db.finish_reply(answer, "Mitochondria [1].", std::slice::from_ref(&citation))?);
    let answer = db.message(answer)?.unwrap();
    assert_eq!(answer.status, MessageStatus::Complete);
    let kept = &answer.citations[0];
    assert_eq!((kept.source_id, &kept.quote), (None, &citation.quote));
    Ok(())
}

#[test]
fn files_alone_get_no_answer() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    db.post_message(session, MessageRole::User, &[notes], &read_everything)?;
    assert_eq!(db.list_messages(session)?.len(), 1);
    Ok(())
}

#[test]
fn posting_moves_the_session_to_the_top() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let older = db.create_session(project.id, "Older")?;
    db.create_session(project.id, "Newer")?;
    db.connection
        .execute("UPDATE sessions SET updated_at = 0", [])?;
    db.post_message(older.id, MessageRole::User, &[text("hello")], &read_nothing)?;
    assert_eq!(db.list_sessions(project.id)?[0].id, older.id);
    Ok(())
}

#[test]
fn a_failing_attachment_rolls_back_the_whole_message() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let result = db.post_message(
        session,
        MessageRole::User,
        &[
            text("see attached"),
            NewPart::File(dir.path().join("missing.pdf")),
        ],
        &read_everything,
    );
    assert!(result.is_err());
    assert!(db.list_messages(session)?.is_empty());
    assert!(db.list_sources()?.is_empty());
    Ok(())
}

#[test]
fn invalid_messages_are_rejected() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    assert!(
        db.post_message(session, MessageRole::User, &[], &read_nothing)
            .is_err()
    );
    assert!(
        db.post_message(session, MessageRole::User, &[text("  ")], &read_nothing)
            .is_err()
    );
    assert!(
        db.post_message(
            SessionId::new(session.get() + 1),
            MessageRole::User,
            &[text("hi")],
            &read_nothing
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn deleting_a_session_keeps_attachments_and_deleting_a_source_keeps_the_part() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let file = attach(dir.path(), "slides.pdf", "%PDF")?;

    let posted = db.post_message(
        session,
        MessageRole::User,
        std::slice::from_ref(&file),
        &read_nothing,
    )?;
    let PartContent::Source { source_id, .. } = posted.parts[0].content else {
        panic!("expected a source part");
    };
    db.delete_source(source_id.unwrap())?;
    let listed = db.list_messages(session)?;
    assert_eq!(
        listed[0].parts[0].content,
        PartContent::Source {
            source_id: None,
            name: "slides.pdf".into(),
            kind: SourceKind::Pdf,
        }
    );

    db.post_message(session, MessageRole::User, &[file], &read_nothing)?;
    db.delete_session(session)?;
    assert_eq!(db.list_sources()?.len(), 1);
    Ok(())
}

#[test]
fn a_finished_answer_is_asked_for_again() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    db.post_message(
        session,
        MessageRole::User,
        &[text("@study what makes ATP?")],
        &read_nothing,
    )?;
    let answer = db.list_messages(session)?.pop().expect("the answer");
    // Not finished yet: nothing to ask again.
    assert_eq!(db.reanswer(answer.id)?, None);
    let job = db.claim_job(&[JobKind::Reply])?.expect("the reply job");
    db.begin_reply(answer.id)?;
    db.finish_reply(answer.id, "Mitochondria [1].", &[])?;
    db.succeed_job(job.id, &[])?;

    let again = db.reanswer(answer.id)?.expect("a new job");
    assert_ne!(again, job.id);
    let answer = db.message(answer.id)?.expect("still there");
    assert_eq!(answer.status, MessageStatus::Pending);
    // The old words stay on screen until the new ones replace them.
    assert_eq!(answer.parts.len(), 1);
    assert_eq!(answer.reply.map(|job| job.id), Some(again));

    // An answer showing material is written again through its material.
    db.post_message(
        session,
        MessageRole::User,
        &[text("/flashcards")],
        &read_nothing,
    )?;
    let material = db
        .list_messages(session)?
        .pop()
        .expect("the material answer");
    assert_eq!(db.reanswer(material.id)?, None);
    Ok(())
}

#[test]
fn messages_can_be_deleted() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let message = db.post_message(session, MessageRole::User, &[text("hi")], &read_nothing)?;
    assert!(db.delete_message(message.id)?);
    assert!(!db.delete_message(message.id)?);
    assert!(db.list_messages(session)?.is_empty());
    Ok(())
}

#[test]
fn an_attachment_opens_a_thread_that_stays_off_the_timeline() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let session = db.create_untitled_session(project.id, "New session")?;
    let lecture = attach(dir.path(), "lecture.mp3", "ID3")?;
    let posted = db.post_message(
        session.id,
        MessageRole::User,
        &[text("Lecture 4"), lecture],
        &read_everything,
    )?;
    let root = posted.parts[1].id;

    let slides = attach(dir.path(), "slides.pdf", "%PDF")?;
    let note = db.post_message(
        Place::Thread(root),
        MessageRole::User,
        &[text("The Krebs cycle starts at 12:30"), slides],
        &read_everything,
    )?;
    assert_eq!(note.thread_root, Some(root));
    db.post_message(
        Place::Thread(root),
        MessageRole::User,
        &[text("@study what comes after citrate?")],
        &read_nothing,
    )?;

    // The timeline keeps only the opening message, which counts the thread's replies.
    let timeline = db.list_messages(session.id)?;
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].parts[0].thread, ThreadSummary::default());
    let summary = timeline[0].parts[1].thread;
    assert_eq!(summary.replies, 3);
    assert!(summary.last_reply_at.is_some());

    // The thread opens with the attachment and its read, then every reply, the answer too.
    let thread = db.thread(root)?.expect("a thread");
    assert_eq!(thread.root, timeline[0].parts[1]);
    assert_eq!(thread.root.jobs.len(), 1);
    assert_eq!(thread.opening().parts, std::slice::from_ref(&thread.root));
    let roles: Vec<_> = thread
        .replies
        .iter()
        .map(|reply| (reply.role, reply.thread_root))
        .collect();
    assert_eq!(
        roles,
        [
            (MessageRole::User, Some(root)),
            (MessageRole::User, Some(root)),
            (MessageRole::Assistant, Some(root)),
        ]
    );
    assert!(thread.replies[2].reply.is_some());
    // A thread's files are read like any other.
    assert_eq!(thread.replies[0].parts[1].jobs.len(), 1);
    // Only the timeline names the session: one title job, from the opening message.
    assert_eq!(db.jobs_for(JobTarget::Session(session.id))?.len(), 1);

    // Deleting the opening message takes its threads with it.
    assert!(db.delete_message(posted.id)?);
    assert!(db.thread(root)?.is_none());
    assert!(db.message(note.id)?.is_none());
    Ok(())
}

#[test]
fn threads_hang_only_off_attachments_of_timeline_messages() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    let posted = db.post_message(
        session,
        MessageRole::User,
        &[text("see file"), notes.clone()],
        &read_nothing,
    )?;
    let (note, file) = (posted.parts[0].id, posted.parts[1].id);
    let reply = db.post_message(
        Place::Thread(file),
        MessageRole::User,
        &[notes],
        &read_nothing,
    )?;
    let nested = reply.parts[0].id;

    for root in [note, nested, crate::PartId::new(nested.get() + 100)] {
        assert!(db.thread(root)?.is_none());
        let posted = db.post_message(
            Place::Thread(root),
            MessageRole::User,
            &[text("hi")],
            &read_nothing,
        );
        assert!(posted.is_err());
    }
    assert_eq!(db.thread(file)?.expect("a thread").replies.len(), 1);
    Ok(())
}

#[test]
fn a_note_written_while_recording_is_marked_with_how_far_in() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let before = db.post_message(session, MessageRole::User, &[text("before")], &read_nothing)?;
    assert_eq!(before.recording_ms, None);

    let recording = db.create_recording(session)?;
    // Three seconds of 16 kHz audio.
    db.append_recording(recording.id, &vec![0; 48_000])?;
    let during = db.post_message(
        session,
        MessageRole::User,
        &[text("the Krebs cycle starts here")],
        &read_nothing,
    )?;
    assert_eq!(during.recording_ms, Some(3_000));
    assert_eq!(db.message(during.id)?.unwrap().recording_ms, Some(3_000));

    // Once posted, the recording's file is where the note leads.
    let posted = db.post_message(
        session,
        MessageRole::User,
        &[NewPart::Recording {
            id: recording.id,
            name: "Lecture.wav".into(),
        }],
        &read_nothing,
    )?;
    assert_eq!(
        posted.recording_ms, None,
        "the recording itself is not a note in it"
    );
    let PartContent::Source {
        source_id: Some(file),
        ..
    } = posted.parts[0].content
    else {
        panic!("the recording's file");
    };
    assert_eq!(db.message(during.id)?.unwrap().recorded_in, Some(file));
    assert_eq!(db.message(before.id)?.unwrap().recorded_in, None);
    Ok(())
}
