//! Posting, listing, answering and deleting messages.

use crate::Result;
use crate::db::{
    Asked, Database, JobTarget, MessageRole, MessageStatus, NewPart, PartContent, Place, Rewrite,
    VersionOrigin, read_nothing,
};
use crate::{
    Anchor, Citation, ErrorKind, Failure, JobKind, JobStatus, MessageId, ProjectId, SessionId,
    SourceKind,
};
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
    assert_eq!(posted.text(), "Summarize this");
    assert_eq!(posted.versions.len(), 1);
    assert_eq!(posted.versions[0].origin, VersionOrigin::Typed);
    assert_eq!(posted.parts.len(), 1);
    let PartContent {
        source_id, name, ..
    } = &posted.parts[0].content;
    assert_eq!(name, "notes.txt");
    assert_eq!(posted.parts[0].jobs[0].status, crate::JobStatus::Queued);

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

#[test]
fn a_rewrite_waits_for_the_files_of_the_message_to_be_read() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    let message = db.post_message(
        session,
        MessageRole::User,
        &[text("Mitochondria power the cell."), notes],
        &read_everything,
    )?;
    let read = message.parts[0].jobs[0].id;

    let Asked::Queued(job) = db.rewrite_message(message.id, &Rewrite::Summarize)? else {
        panic!("queued");
    };
    let waiting = db.job(job)?.expect("the job");
    assert_eq!(waiting.status, JobStatus::Blocked, "the read is not done");

    db.claim_job(&[JobKind::Extract])?.expect("the read");
    db.succeed_job(read, &[])?;
    assert_eq!(db.job(job)?.unwrap().status, JobStatus::Queued);
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
    let root = note.parts[0].id;
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
    let PartContent { source_id, .. } = question.parts[0].content;

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

    let pending = db
        .begin_version(answer.id, JobKind::Reply)?
        .expect("a version to write");
    assert_eq!(pending.origin, VersionOrigin::Answer);
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
    assert!(db.finish_version(
        pending.id,
        "Mitochondria [1].",
        std::slice::from_ref(&citation)
    )?);
    let answer = db.message(answer.id)?.unwrap();
    assert_eq!(answer.status, MessageStatus::Complete);
    assert_eq!(answer.text(), "Mitochondria [1].");
    assert!(answer.parts.is_empty());
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
    let PartContent { source_id, .. } = question.parts[0].content;
    let answer = db.list_messages(session)?[1].id;
    let pending = db
        .begin_version(answer, JobKind::Reply)?
        .expect("a version to write");
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

    assert!(db.finish_version(
        pending.id,
        "Mitochondria [1].",
        std::slice::from_ref(&citation)
    )?);
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
    let PartContent { source_id, .. } = posted.parts[0].content;
    db.delete_source(source_id.unwrap())?;
    let listed = db.list_messages(session)?;
    assert_eq!(
        listed[0].parts[0].content,
        PartContent {
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
fn a_finished_answer_is_asked_for_again_and_the_old_one_stays_until_the_new_one_is_done()
-> Result<()> {
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
    assert_eq!(db.reanswer(answer.id)?, Asked::Unavailable);
    let job = db.claim_job(&[JobKind::Reply])?.expect("the reply job");
    let first = db
        .begin_version(answer.id, JobKind::Reply)?
        .expect("the first version");
    db.finish_version(first.id, "Mitochondria [1].", &[])?;
    db.succeed_job(job.id, &[])?;

    let Asked::Queued(again) = db.reanswer(answer.id)? else {
        panic!("a new job");
    };
    assert_ne!(again, job.id);
    let answer = db.message(answer.id)?.expect("still there");
    assert_eq!(answer.status, MessageStatus::Pending);
    // The old words stay on screen until the new ones replace them.
    assert_eq!(answer.text(), "Mitochondria [1].");
    assert_eq!(answer.versions.len(), 2);
    assert_eq!(answer.reply.map(|job| job.id), Some(again));
    assert_eq!(db.reanswer(answer.id)?, Asked::Busy);

    let second = db
        .begin_version(answer.id, JobKind::Reply)?
        .expect("the second version");
    assert_eq!(second.source_text, "Mitochondria [1].");
    db.finish_version(second.id, "In the mitochondria.", &[])?;
    let answer = db.message(answer.id)?.unwrap();
    assert_eq!(answer.status, MessageStatus::Complete);
    assert_eq!(answer.text(), "In the mitochondria.");
    assert_eq!(answer.active().map(|version| version.number), Some(2));

    let note = db.post_message(session, MessageRole::User, &[text("hi")], &read_nothing)?;
    assert_eq!(db.reanswer(note.id)?, Asked::Unavailable);
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
    let root = posted.parts[0].id;

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
    let summary = timeline[0].parts[0].thread;
    assert_eq!(summary.replies, 3);
    assert!(summary.last_reply_at.is_some());

    // The thread opens with the attachment and its read, then every reply, the answer too.
    let thread = db.thread(root)?.expect("a thread");
    assert_eq!(thread.root, timeline[0].parts[0]);
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
    assert_eq!(thread.replies[0].parts[0].jobs.len(), 1);
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
    let file = posted.parts[0].id;
    let reply = db.post_message(
        Place::Thread(file),
        MessageRole::User,
        &[notes],
        &read_nothing,
    )?;
    let nested = reply.parts[0].id;

    for root in [nested, crate::PartId::new(nested.get() + 100)] {
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
    let file = posted.parts[0].content.source_id.expect("the file");
    assert_eq!(db.message(during.id)?.unwrap().recorded_in, Some(file));
    assert_eq!(db.message(before.id)?.unwrap().recorded_in, None);
    Ok(())
}

/// A note in a session of `db`.
fn note(db: &Database, session: SessionId, words: &str) -> Result<MessageId> {
    Ok(db
        .post_message(session, MessageRole::User, &[text(words)], &read_nothing)?
        .id)
}

fn cited(quote: &str) -> Citation {
    Citation {
        marker: 1,
        source_id: None,
        source_name: "notes.txt".into(),
        anchor: Anchor::Text {
            line_start: 1,
            line_end: 1,
            start: 0,
            end: 1,
        },
        quote: quote.into(),
    }
}

#[test]
fn an_edit_adds_an_active_version_and_unchanged_or_empty_text_adds_nothing() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "Mitochondria make ATP")?;

    assert_eq!(db.edit_message(id, "Mitochondria make ATP  ")?, None);
    assert_eq!(db.edit_message(id, "   ")?, None);
    assert_eq!(db.edit_message(MessageId::new(id.get() + 9), "x")?, None);
    assert_eq!(db.message(id)?.unwrap().versions.len(), 1);

    let edited = db
        .edit_message(id, " Mitochondria make most ATP ")?
        .expect("a version");
    let message = db.message(id)?.unwrap();
    assert_eq!(message.active_version, Some(edited));
    assert_eq!(message.text(), "Mitochondria make most ATP");
    let numbers: Vec<_> = message
        .versions
        .iter()
        .map(|version| (version.number, version.origin))
        .collect();
    assert_eq!(
        numbers,
        [(1, VersionOrigin::Typed), (2, VersionOrigin::Edited)]
    );
    assert_eq!(message.versions[1].based_on, Some(message.versions[0].id));
    Ok(())
}

#[test]
fn a_message_of_only_files_has_no_text_until_one_is_written() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let notes = attach(dir.path(), "notes.txt", "mitochondria")?;
    let posted = db.post_message(session, MessageRole::User, &[notes], &read_nothing)?;
    assert!(posted.versions.is_empty() && posted.active_version.is_none());
    assert_eq!(posted.text(), "");
    assert_eq!(db.reanswer(posted.id)?, Asked::Unavailable);

    // A rewrite starts from the files, so its version is based on nothing.
    let Asked::Queued(_) = db.rewrite_message(posted.id, &Rewrite::Summarize)? else {
        panic!("a message of only files is written about from them");
    };
    let pending = db
        .begin_version(posted.id, JobKind::Rewrite)?
        .expect("the version waits to be written");
    assert_eq!(pending.source_text, "");
    assert!(pending.citations.is_empty());
    db.finish_version(pending.id, "A summary of the notes", &[])?;
    let written = db.message(posted.id)?.unwrap();
    assert_eq!(written.text(), "A summary of the notes");
    assert_eq!(written.versions[0].based_on, None);

    db.edit_message(posted.id, "Slides from today")?;
    let message = db.message(posted.id)?.unwrap();
    assert_eq!(message.versions[1].origin, VersionOrigin::Edited);
    assert_eq!(message.text(), "Slides from today");
    assert_eq!(message.parts.len(), 1);
    Ok(())
}

#[test]
fn a_rewrite_is_a_version_written_by_a_job_and_active_once_done() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "mito makes atp")?;

    assert!(
        db.rewrite_message(id, &Rewrite::Instruction("  ".into()))
            .is_err()
    );
    let Asked::Queued(job) = db.rewrite_message(id, &Rewrite::Instruction(" as a poem ".into()))?
    else {
        panic!("queued");
    };
    let queued = db.message(id)?.unwrap();
    assert_eq!(queued.status, MessageStatus::Pending);
    assert_eq!(queued.text(), "mito makes atp", "the old words stay");
    let version = queued.unfinished().expect("the version being written");
    assert_eq!(
        (
            version.origin,
            version.instruction.as_deref(),
            version.text.as_str()
        ),
        (VersionOrigin::Instruction, Some("as a poem"), "")
    );
    let reply = queued.reply.as_ref().expect("its job");
    assert_eq!((reply.id, reply.kind), (job, JobKind::Rewrite));
    assert_eq!(reply.target, JobTarget::Message(id));

    let claimed = db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    let pending = db
        .begin_version(id, JobKind::Rewrite)?
        .expect("the version");
    assert_eq!(pending.source_text, "mito makes atp");
    assert_eq!(db.message(id)?.unwrap().status, MessageStatus::Writing);
    assert!(db.finish_version(pending.id, "Mitochondria, small", &[cited("a")])?);
    db.succeed_job(claimed.id, &[])?;

    let done = db.message(id)?.unwrap();
    assert_eq!(done.status, MessageStatus::Complete);
    assert_eq!(done.text(), "Mitochondria, small");
    assert_eq!(done.citations.len(), 1);
    assert!(!db.finish_version(pending.id, "again", &[])?);
    Ok(())
}

#[test]
fn only_one_version_is_written_at_a_time() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "mito makes atp")?;
    assert!(matches!(
        db.rewrite_message(id, &Rewrite::Improve)?,
        Asked::Queued(_)
    ));
    for how in [Rewrite::Summarize, Rewrite::Improve] {
        assert_eq!(db.rewrite_message(id, &how)?, Asked::Busy);
    }
    db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    assert_eq!(db.rewrite_message(id, &Rewrite::Summarize)?, Asked::Busy);
    assert_eq!(db.message(id)?.unwrap().versions.len(), 2);

    write_version_in_flight(&db, id)?;
    assert!(matches!(
        db.rewrite_message(id, &Rewrite::Summarize)?,
        Asked::Queued(_)
    ));
    assert_eq!(
        db.rewrite_message(MessageId::new(id.get() + 9), &Rewrite::Improve)?,
        Asked::Unavailable
    );
    Ok(())
}

/// Finishes the version of `message` whose job is already running.
fn write_version_in_flight(db: &Database, message: MessageId) -> Result<()> {
    let pending = db
        .begin_version(message, JobKind::Rewrite)?
        .expect("a version to write");
    assert!(db.finish_version(pending.id, "Done", &[])?);
    let job = db
        .jobs_for(JobTarget::Message(message))?
        .pop()
        .expect("its job");
    db.succeed_job(job.id, &[])?;
    Ok(())
}

#[test]
fn a_version_stays_inactive_when_the_one_it_revises_is_no_longer_active() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "first")?;
    let second = db.edit_message(id, "second")?.expect("an edit");
    let first = db.message(id)?.unwrap().versions[0].id;

    db.rewrite_message(id, &Rewrite::Improve)?;
    // While it is written the student goes back to the first version.
    assert!(db.set_active_version(id, first)?);
    let job = db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    let pending = db
        .begin_version(id, JobKind::Rewrite)?
        .expect("the version");
    assert_eq!(pending.source_text, "second");
    assert!(db.finish_version(pending.id, "second, improved", &[])?);
    db.succeed_job(job.id, &[])?;

    let message = db.message(id)?.unwrap();
    assert_eq!(
        message.active_version,
        Some(first),
        "the student's choice stands"
    );
    assert_eq!(message.versions.len(), 3);
    assert_eq!(message.versions[2].text, "second, improved");
    assert_eq!(message.status, MessageStatus::Complete);

    // It is still there to switch to; versions of other messages and unfinished ones are not.
    assert!(db.set_active_version(id, message.versions[2].id)?);
    assert!(db.set_active_version(id, second)?);
    let other = note(&db, session, "other")?;
    let theirs = db.message(other)?.unwrap().versions[0].id;
    assert!(!db.set_active_version(id, theirs)?);
    db.rewrite_message(id, &Rewrite::Summarize)?;
    let unfinished = db.message(id)?.unwrap().unfinished().unwrap().id;
    assert!(!db.set_active_version(id, unfinished)?);
    Ok(())
}

#[test]
fn a_failed_version_stays_for_a_retry_and_is_dropped_by_the_next_action() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "mito makes atp")?;
    db.rewrite_message(id, &Rewrite::Improve)?;
    let job = db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    let pending = db
        .begin_version(id, JobKind::Rewrite)?
        .expect("the version");
    db.fail_job(job.id, &Failure::new(ErrorKind::Internal, "boom"), None)?;

    let failed = db.message(id)?.unwrap();
    assert_eq!(
        failed.unfinished().map(|version| version.id),
        Some(pending.id)
    );
    assert_eq!(
        failed.reply.as_ref().map(|job| job.status),
        Some(JobStatus::Failed)
    );
    assert_eq!(failed.text(), "mito makes atp");

    assert!(db.retry_job(job.id)?);
    assert_eq!(db.rewrite_message(id, &Rewrite::Summarize)?, Asked::Busy);
    db.claim_job(&[JobKind::Rewrite])?.expect("the job again");
    assert_eq!(
        db.begin_version(id, JobKind::Rewrite)?
            .map(|version| version.id),
        Some(pending.id)
    );
    db.fail_job(job.id, &Failure::new(ErrorKind::Internal, "boom"), None)?;

    // Asking for something else drops the failed version and its job.
    let Asked::Queued(next) = db.rewrite_message(id, &Rewrite::Summarize)? else {
        panic!("queued");
    };
    assert_ne!(next, job.id);
    let message = db.message(id)?.unwrap();
    assert_eq!(message.versions.len(), 2);
    assert_eq!(message.versions[1].origin, VersionOrigin::Summarize);
    assert_eq!(
        message.versions[1].number, 2,
        "the dropped number is reused"
    );
    assert_eq!(db.jobs_for(JobTarget::Message(id))?.len(), 1);
    assert!(!db.finish_version(pending.id, "late", &[])?);
    Ok(())
}

#[test]
fn an_edit_drops_the_version_being_written() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "mito makes atp")?;
    db.rewrite_message(id, &Rewrite::Improve)?;
    db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    let pending = db
        .begin_version(id, JobKind::Rewrite)?
        .expect("the version");

    db.edit_message(id, "mitochondria make atp")?;
    let message = db.message(id)?.unwrap();
    assert!(message.unfinished().is_none());
    assert_eq!(message.text(), "mitochondria make atp");
    assert!(!db.finish_version(pending.id, "stale", &[])?);
    assert_eq!(db.begin_version(id, JobKind::Rewrite)?, None);
    assert_eq!(db.message(id)?.unwrap().text(), "mitochondria make atp");
    Ok(())
}

#[test]
fn edits_and_rewrites_never_start_an_answer_or_a_title() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let session = db.create_untitled_session(project.id, "New session")?;
    let asked = db.post_message(
        session.id,
        MessageRole::User,
        &[text("what is ATP?")],
        &read_nothing,
    )?;
    db.edit_message(asked.id, "@study what is ATP?")?;
    db.rewrite_message(asked.id, &Rewrite::Improve)?;
    // One title job from posting, one rewrite: no reply, no second title.
    assert_eq!(db.list_messages(session.id)?.len(), 1);
    assert_eq!(db.jobs_for(JobTarget::Session(session.id))?.len(), 1);
    assert_eq!(db.jobs_for(JobTarget::Message(asked.id))?.len(), 1);
    Ok(())
}

#[test]
fn each_version_keeps_its_own_citations_and_the_active_ones_are_shown() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    db.post_message(
        session,
        MessageRole::User,
        &[text("@study what makes ATP?")],
        &read_nothing,
    )?;
    let answer = db.list_messages(session)?[1].id;
    let job = db.claim_job(&[JobKind::Reply])?.expect("the reply job");
    let first = db
        .begin_version(answer, JobKind::Reply)?
        .expect("a version");
    assert!(db.finish_version(first.id, "Mitochondria [1].", &[cited("one")])?);
    db.succeed_job(job.id, &[])?;
    db.reanswer(answer)?;
    let second = db
        .begin_version(answer, JobKind::Reply)?
        .expect("a version");
    assert!(db.finish_version(second.id, "Inside them [1].", &[cited("two")])?);

    let message = db.message(answer)?.unwrap();
    assert_eq!(message.citations[0].quote, "two");
    assert!(db.set_active_version(answer, first.id)?);
    assert_eq!(db.message(answer)?.unwrap().citations[0].quote, "one");
    Ok(())
}

#[test]
fn search_and_notes_read_the_active_version_only() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (project, session) = cells(&db)?;
    let id = note(&db, session, "mitochondria power the cell")?;
    let first = db.message(id)?.unwrap().versions[0].id;
    let hits = |query: &str| db.message_hits(query, 10).map(|hits| hits.len());
    assert_eq!(hits("mitochondria")?, 1);

    db.edit_message(id, "ribosomes build proteins")?;
    assert_eq!(hits("mitochondria")?, 0, "an old version is not found");
    assert_eq!(hits("ribosomes")?, 1);
    assert_eq!(
        db.project_material(project)?.notes,
        "ribosomes build proteins"
    );

    // A version being written has no words to find or to read.
    db.rewrite_message(id, &Rewrite::Instruction("in French".into()))?;
    assert_eq!(
        db.project_material(project)?.notes,
        "ribosomes build proteins"
    );
    db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    let pending = db
        .begin_version(id, JobKind::Rewrite)?
        .expect("the version");
    assert!(db.finish_version(pending.id, "ribosomes construisent des proteines", &[])?);
    assert_eq!(hits("construisent")?, 1);
    assert_eq!(
        hits("ribosomes")?,
        1,
        "one hit for the message, not one per version"
    );

    assert!(db.set_active_version(id, first)?);
    assert_eq!(hits("construisent")?, 0);
    assert_eq!(hits("mitochondria")?, 1);
    assert_eq!(
        db.project_material(project)?.notes,
        "mitochondria power the cell"
    );

    assert!(db.delete_message(id)?);
    assert_eq!(hits("mitochondria")?, 0);
    assert_eq!(hits("ribosomes")?, 0);
    Ok(())
}

#[test]
fn a_hit_beyond_the_limit_is_not_lost_to_inactive_versions() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "krebs krebs krebs krebs")?;
    db.edit_message(id, "nothing here")?;
    note(&db, session, "krebs cycle")?;
    // The old version matches best, but only the other message's words are found, and the
    // limit counts hits, not rows filtered afterwards.
    assert_eq!(db.message_hits("krebs", 1)?.len(), 1);
    Ok(())
}

#[test]
fn a_job_never_writes_a_version_of_another_kind_of_job() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "mitochondria power the cell")?;
    db.rewrite_message(id, &Rewrite::Improve)?;
    let rewriting = || {
        db.message(id)
            .map(|message| message.unwrap().versions.last().unwrap().status)
    };
    let before = rewriting()?;

    // The answer's job finds a rewrite: it takes nothing and leaves the version as it was.
    assert_eq!(db.begin_version(id, JobKind::Reply)?, None);
    assert_eq!(rewriting()?, before);
    assert!(db.begin_version(id, JobKind::Rewrite)?.is_some());

    db.post_message(
        session,
        MessageRole::User,
        &[text("@study what makes ATP?")],
        &read_nothing,
    )?;
    let answer = db.list_messages(session)?[2].id;
    let waiting = db.message(answer)?.unwrap().versions[0].status;
    assert_eq!(db.begin_version(answer, JobKind::Rewrite)?, None);
    assert_eq!(db.message(answer)?.unwrap().versions[0].status, waiting);
    db.claim_job(&[JobKind::Reply])?.expect("the reply job");
    assert!(db.begin_version(answer, JobKind::Reply)?.is_some());
    Ok(())
}

#[test]
fn an_edit_removes_the_job_writing_the_version_it_drops_even_when_running() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    let id = note(&db, session, "mitochondria power the cell")?;
    db.rewrite_message(id, &Rewrite::Improve)?;
    let job = db.claim_job(&[JobKind::Rewrite])?.expect("the job");

    db.edit_message(id, "ribosomes build proteins")?
        .expect("an edit");
    assert!(db.job(job.id)?.is_none(), "the running job is deleted");
    assert!(matches!(
        db.rewrite_message(id, &Rewrite::Summarize)?,
        Asked::Queued(_)
    ));
    Ok(())
}

#[test]
fn a_rewrite_that_cites_leaves_no_markers_in_the_notes() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (project, session) = cells(&db)?;
    let id = note(&db, session, "mitochondria power the cell")?;
    db.rewrite_message(id, &Rewrite::Improve)?;
    db.claim_job(&[JobKind::Rewrite])?.expect("the job");
    let pending = db
        .begin_version(id, JobKind::Rewrite)?
        .expect("the version");
    assert!(db.finish_version(
        pending.id,
        "Mitochondria power the cell [1].",
        &[cited("mitochondria")]
    )?);

    let message = db.message(id)?.unwrap();
    assert_eq!(message.citations.len(), 1);
    assert_eq!(message.plain_text(), "Mitochondria power the cell.");
    assert_eq!(
        db.project_material(project)?.notes,
        "Mitochondria power the cell."
    );
    Ok(())
}

#[test]
fn brackets_in_a_note_without_citations_are_kept() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (project, session) = cells(&db)?;
    let id = note(&db, session, "why is a[0] not a[1] since [2024]")?;

    let message = db.message(id)?.unwrap();
    assert_eq!(message.plain_text(), "why is a[0] not a[1] since [2024]");
    assert_eq!(
        db.project_material(project)?.notes,
        "why is a[0] not a[1] since [2024]"
    );
    Ok(())
}

#[test]
fn a_rewrite_is_given_the_citations_of_the_version_it_revises() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let (_, session) = cells(&db)?;
    db.post_message(
        session,
        MessageRole::User,
        &[text("@study what makes ATP?")],
        &read_nothing,
    )?;
    let answer = db.list_messages(session)?[1].id;
    let job = db.claim_job(&[JobKind::Reply])?.expect("the reply job");
    let first = db
        .begin_version(answer, JobKind::Reply)?
        .expect("a version");
    assert!(first.citations.is_empty());
    assert!(db.finish_version(first.id, "Mitochondria [1].", &[cited("one")])?);
    db.succeed_job(job.id, &[])?;

    let asked = db.rewrite_message(answer, &Rewrite::Improve)?;
    assert!(matches!(asked, Asked::Queued(_)), "{asked:?}");
    let pending = db
        .begin_version(answer, JobKind::Rewrite)?
        .expect("a version");
    assert_eq!(pending.source_text, "Mitochondria [1].");
    assert_eq!(pending.citations, [cited("one")]);
    Ok(())
}
