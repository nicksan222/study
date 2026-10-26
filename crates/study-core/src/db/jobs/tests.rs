//! The job rows: dedupe, dependencies, twins, retry state, and scope.

use super::*;
use crate::Result;
use crate::db::{Database, MessageRole, NewPart, unix_timestamp};
use crate::{ErrorKind, Failure};
use rusqlite::params;

fn database() -> Result<(tempfile::TempDir, Database, SourceId)> {
    let (dir, db) = crate::db::Database::temporary()?;
    let file = dir.path().join("notes.txt");
    std::fs::write(&file, "notes")?;
    let source = db.import_source(&file, None)?;
    Ok((dir, db, source.id))
}

fn extract(source: SourceId) -> NewJob {
    NewJob::new(JobKind::Extract, JobTarget::Source(source))
}

#[test]
fn dedupe_keys_name_the_kind_the_target_and_the_args() {
    let targets = [
        (JobTarget::Source(SourceId::new(7)), "source:7"),
        (JobTarget::Document(DocumentId::new(7)), "document:7"),
        (JobTarget::Session(SessionId::new(7)), "session:7"),
        (JobTarget::Message(MessageId::new(7)), "message:7"),
        (JobTarget::Artifact(ArtifactId::new(7)), "artifact:7"),
        (JobTarget::Question(QuestionId::new(7)), "question:7"),
    ];
    for (target, key) in targets {
        assert_eq!(target.key(), key);
    }
    let job = NewJob::new(JobKind::Title, JobTarget::Session(SessionId::new(3)))
        .with_args(serde_json::json!({ "again": true }));
    assert_eq!(job.dedupe_key(), r#"title:session:3:{"again":true}"#);
}

#[test]
fn waiting_work_is_queued_once() -> Result<()> {
    let (_dir, db, source) = database()?;
    let first = db.enqueue_job(&extract(source))?;
    assert_eq!(db.enqueue_job(&extract(source))?, first);
    // Once it runs, the same work can wait again behind it.
    let claimed = db.claim_job(&[JobKind::Extract])?.unwrap();
    assert_eq!(
        (claimed.id, claimed.status, claimed.attempts),
        (first, JobStatus::Running, 1)
    );
    assert_ne!(db.enqueue_job(&extract(source))?, first);
    Ok(())
}

#[test]
fn work_asked_for_once_is_not_queued_again_while_it_runs() -> Result<()> {
    let (_dir, db, source) = database()?;
    let first = db.enqueue_job_once(&extract(source))?;
    assert_eq!(db.enqueue_job_once(&extract(source))?, first);
    db.claim_job(&[JobKind::Extract])?.unwrap();
    assert_eq!(db.enqueue_job_once(&extract(source))?, first);
    assert_eq!(
        db.sessions_with_pending(JobKind::Extract)?,
        Vec::<SessionId>::new()
    );
    // Once it has ended, asking again is new work.
    db.succeed_job(first, &[])?;
    assert_ne!(db.enqueue_job_once(&extract(source))?, first);
    Ok(())
}

#[test]
fn jobs_are_claimed_by_kind_oldest_first() -> Result<()> {
    let (_dir, db, source) = database()?;
    let extract_id = db.enqueue_job(&extract(source))?;
    let other = db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Source(source)))?;
    assert_eq!(db.claim_job(&[JobKind::Title])?.unwrap().id, other);
    assert_eq!(
        db.claim_job(&[JobKind::Extract, JobKind::Title])?
            .unwrap()
            .id,
        extract_id
    );
    assert_eq!(db.claim_job(&[JobKind::Extract])?, None);
    assert_eq!(db.claim_job(&[])?, None);
    Ok(())
}

#[test]
fn a_blocked_job_waits_until_its_dependencies_end_however_they_end() -> Result<()> {
    let (_dir, db, source) = database()?;
    let first = db.enqueue_job(&extract(source))?;
    let waiting =
        db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Source(source)).after([first]))?;
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Blocked);
    assert_eq!(db.claim_job(&[JobKind::Title])?, None);

    db.claim_job(&[JobKind::Extract])?;
    let failure = Failure::new(ErrorKind::Unsupported, "cannot read it");
    assert!(db.fail_job(first, &failure, None)?);
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Queued);
    Ok(())
}

#[test]
fn success_queues_followups_in_the_same_step() -> Result<()> {
    let (_dir, db, source) = database()?;
    let id = db.enqueue_job(&extract(source))?;
    db.claim_job(&[JobKind::Extract])?;
    let followup = NewJob::new(JobKind::Title, JobTarget::Source(source));
    assert!(db.succeed_job(id, std::slice::from_ref(&followup))?);
    assert_eq!(db.job(id)?.unwrap().status, JobStatus::Succeeded);
    assert!(db.claim_job(&[JobKind::Title])?.is_some());
    // A job that is not running accepts no outcome.
    assert!(!db.succeed_job(id, &[])?);
    Ok(())
}

#[test]
fn failures_keep_their_kind_and_can_be_retried_later_or_now() -> Result<()> {
    let (_dir, db, source) = database()?;
    let id = db.enqueue_job(&extract(source))?;
    db.claim_job(&[JobKind::Extract])?;
    let offline = Failure::new(ErrorKind::Transient, "offline");
    let later = unix_timestamp() + 60;
    assert!(db.fail_job(id, &offline, Some(later))?);
    let queued = db.job(id)?.unwrap();
    assert_eq!(
        (queued.status, queued.error_kind),
        (JobStatus::Queued, Some(ErrorKind::Transient))
    );
    // Not due yet.
    assert_eq!(db.claim_job(&[JobKind::Extract])?, None);
    assert_eq!(db.next_job_retry()?, Some(later));

    db.cancel_job(id)?;
    assert!(db.retry_job(id)?);
    let retried = db.claim_job(&[JobKind::Extract])?.unwrap();
    assert_eq!(
        (retried.id, retried.error_kind, retried.attempts),
        (id, None, 1)
    );
    Ok(())
}

#[test]
fn setup_release_keeps_work_blocked_behind_a_retried_dependency() -> Result<()> {
    let (_dir, db, source) = database()?;
    let read = db.enqueue_job(&extract(source))?;
    let waiting =
        db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Source(source)).after([read]))?;
    let signed_out = Failure::new(ErrorKind::Config, "nobody signed in");
    // The read fails, which lets the work that waited on it run and wait for sign-in.
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, read);
    db.fail_job(read, &signed_out, None)?;
    assert_eq!(db.claim_job(&[JobKind::Title])?.unwrap().id, waiting);
    db.fail_job(waiting, &signed_out, None)?;

    // The terminal read is retried; the title still waits for setup.
    assert_eq!(
        db.retry_failed_jobs(&[JobKind::Title, JobKind::Extract], &[ErrorKind::Config])?,
        1
    );
    assert_eq!(db.job(read)?.unwrap().status, JobStatus::Queued);
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Waiting);

    // Signing in releases the title, but its retried read still keeps it blocked.
    assert_eq!(db.release_waiting(Requirement::LanguageModels)?, 1);
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Blocked);
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, read);
    db.succeed_job(read, &[])?;
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Queued);
    Ok(())
}

#[test]
fn an_older_failed_read_gives_way_to_the_newer_one_and_its_work_waits_for_that() -> Result<()> {
    let (_dir, db, source) = database()?;
    let signed_out = Failure::new(ErrorKind::Config, "nobody signed in");
    let first = db.enqueue_job(&extract(source))?;
    let waiting =
        db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Source(source)).after([first]))?;
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, first);
    db.fail_job(first, &signed_out, None)?;
    assert_eq!(db.claim_job(&[JobKind::Title])?.unwrap().id, waiting);
    db.fail_job(waiting, &signed_out, None)?;
    // Read again by hand, and failed the same way.
    let again = db.enqueue_job(&extract(source))?;
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, again);
    db.fail_job(again, &signed_out, None)?;

    // Only failed reads are retried. The title still waits for sign-in, and its dependency
    // moves from the cancelled older read to the newer one.
    db.retry_failed_jobs(&[JobKind::Title, JobKind::Extract], &[ErrorKind::Config])?;
    assert_eq!(db.job(again)?.unwrap().status, JobStatus::Queued);
    assert_eq!(db.job(first)?.unwrap().status, JobStatus::Cancelled);
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Waiting);

    assert_eq!(db.release_waiting(Requirement::LanguageModels)?, 1);
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Blocked);
    // Nothing is left for a later retry to run again.
    assert_eq!(
        db.retry_failed_jobs(&[JobKind::Extract], &[ErrorKind::Config])?,
        0
    );
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, again);
    db.succeed_job(again, &[])?;
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Queued);
    Ok(())
}

#[test]
fn work_waiting_on_a_read_that_gives_way_to_its_twin_waits_on_the_twin() -> Result<()> {
    let (_dir, db, source) = database()?;
    let running = db.enqueue_job(&extract(source))?;
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, running);
    let waiting =
        db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Source(source)).after([running]))?;
    // The same read, asked for again while the first runs.
    let twin = db.enqueue_job(&extract(source))?;
    assert_ne!(twin, running);

    let hiccup = Failure::new(ErrorKind::Transient, "connection reset");
    db.fail_job(running, &hiccup, Some(unix_timestamp() + 5))?;
    assert_eq!(db.job(running)?.unwrap().status, JobStatus::Failed);
    assert_eq!(db.job(waiting)?.unwrap().status, JobStatus::Blocked);
    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, twin);
    Ok(())
}

#[test]
fn reads_that_needed_a_model_start_again_once_it_is_installed() -> Result<()> {
    let (_dir, db, source) = database()?;
    let id = db.enqueue_job(&extract(source))?;
    db.claim_job(&[JobKind::Extract])?;
    let missing = Failure::new(ErrorKind::ModelUnavailable, "not installed");
    db.fail_job(id, &missing, None)?;
    assert_eq!(
        db.retry_failed_jobs(&[JobKind::Title], &[ErrorKind::ModelUnavailable])?,
        0
    );
    assert_eq!(
        db.retry_failed_jobs(&[JobKind::Extract], &[ErrorKind::ModelUnavailable])?,
        1
    );
    let queued = db.job(id)?.unwrap();
    assert_eq!(
        (queued.status, queued.error_kind),
        (JobStatus::Queued, None)
    );
    Ok(())
}

#[test]
fn work_waiting_twice_is_left_to_the_waiting_twin() -> Result<()> {
    let (_dir, db, source) = database()?;
    let running = db.enqueue_job(&extract(source))?;
    db.claim_job(&[JobKind::Extract])?;
    let twin = db.enqueue_job(&extract(source))?;
    assert_ne!(running, twin);

    // Interrupted, a transient failure, or a manual retry: the twin does the work.
    assert_eq!(db.requeue_interrupted_jobs()?, 1);
    assert_eq!(db.job(running)?.unwrap().status, JobStatus::Cancelled);
    assert!(!db.retry_job(running)?);
    let claimed = db.claim_job(&[JobKind::Extract])?.unwrap();
    assert_eq!(claimed.id, twin);
    let again = db.enqueue_job(&extract(source))?;
    let offline = Failure::new(ErrorKind::Transient, "offline");
    db.fail_job(twin, &offline, Some(unix_timestamp() + 60))?;
    assert_eq!(db.job(twin)?.unwrap().status, JobStatus::Failed);
    assert_eq!(db.job(again)?.unwrap().status, JobStatus::Queued);

    // Several attempts that lacked a model: only the latest runs again.
    let missing = Failure::new(ErrorKind::ModelUnavailable, "not installed");
    db.claim_job(&[JobKind::Extract])?;
    db.fail_job(again, &missing, None)?;
    db.connection.execute(
        "UPDATE jobs SET error_kind = 'model_unavailable', error = 'x' WHERE id = ?1",
        params![twin],
    )?;
    assert_eq!(
        db.retry_failed_jobs(&[JobKind::Extract], &[ErrorKind::ModelUnavailable])?,
        1
    );
    assert_eq!(db.job(again)?.unwrap().status, JobStatus::Queued);
    Ok(())
}

#[test]
fn a_retried_job_still_waits_for_its_dependencies() -> Result<()> {
    let (_dir, db, source) = database()?;
    let read = db.enqueue_job(&extract(source))?;
    let project = db.create_project("Biology")?;
    let session = db.create_session(project.id, "Cells")?;
    let title =
        db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Session(session.id)).after([read]))?;
    db.cancel_job(title)?;
    assert!(db.retry_job(title)?);
    assert_eq!(db.job(title)?.unwrap().status, JobStatus::Blocked);
    db.claim_job(&[JobKind::Extract])?;
    db.succeed_job(read, &[])?;
    assert_eq!(db.job(title)?.unwrap().status, JobStatus::Queued);
    Ok(())
}

#[test]
fn a_job_waiting_on_deleted_work_is_released() -> Result<()> {
    let (_dir, db, source) = database()?;
    let read = db.enqueue_job(&extract(source))?;
    let other = db.create_project("Biology")?;
    let session = db.create_session(other.id, "Cells")?;
    let title =
        db.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Session(session.id)).after([read]))?;
    db.delete_source(source)?;
    assert_eq!(db.job(read)?, None);
    assert_eq!(
        db.claim_job(&[JobKind::Title])?.map(|job| job.id),
        Some(title)
    );
    Ok(())
}

#[test]
fn a_deduplicated_job_waits_for_every_callers_dependencies() -> Result<()> {
    let (dir, db, _) = database()?;
    let file = dir.path().join("more.txt");
    std::fs::write(&file, "more")?;
    let second = db.import_source(&file, None)?;
    let project = db.create_project("Biology")?;
    let session = db.create_session(project.id, "Cells")?;
    let title = || NewJob::new(JobKind::Title, JobTarget::Session(session.id));
    let queued = db.enqueue_job(&title())?;
    let read = db.enqueue_job(&extract(second.id))?;
    assert_eq!(db.enqueue_job(&title().after([read]))?, queued);
    assert_eq!(db.job(queued)?.unwrap().status, JobStatus::Blocked);
    Ok(())
}

#[test]
fn cancelled_and_interrupted_jobs() -> Result<()> {
    let (_dir, db, source) = database()?;
    let id = db.enqueue_job(&extract(source))?;
    db.claim_job(&[JobKind::Extract])?;
    assert_eq!(db.requeue_interrupted_jobs()?, 1);
    assert_eq!(db.job(id)?.unwrap().status, JobStatus::Queued);
    assert!(db.cancel_job(id)?);
    assert!(!db.cancel_job(id)?);
    assert_eq!(db.claim_job(&[JobKind::Extract])?, None);
    Ok(())
}

#[test]
fn jobs_go_with_their_subject_and_know_their_chat() -> Result<()> {
    let (dir, db) = crate::db::Database::temporary()?;
    let project = db.create_project("Biology")?;
    let session = db.create_session(project.id, "Cells")?;
    let file = dir.path().join("slides.pdf");
    std::fs::write(&file, "%PDF-1.7")?;
    let message = db.post_message(
        session.id,
        MessageRole::User,
        &[NewPart::File(file)],
        &|_, _| true,
    )?;
    let job = message.parts[0].jobs[0].id;
    let scope = db.job_scope(job)?;
    assert_eq!(scope.session_id, Some(session.id));
    let overview = &db.list_job_overviews(10)?[0];
    assert_eq!(overview.subject, "slides.pdf");
    assert_eq!(overview.source_kind, Some(SourceKind::Pdf));
    assert_eq!(overview.project_name.as_deref(), Some("Biology"));

    db.delete_source(scope.source_id.unwrap())?;
    assert!(db.list_job_overviews(10)?.is_empty());
    Ok(())
}

/// One of each target, all with id 7. A new [`JobTarget`] variant fails to compile here until
/// it is listed.
fn one_of_each() -> Vec<JobTarget> {
    let all = vec![
        JobTarget::Source(SourceId::new(7)),
        JobTarget::Document(DocumentId::new(7)),
        JobTarget::Session(SessionId::new(7)),
        JobTarget::Message(MessageId::new(7)),
        JobTarget::Artifact(ArtifactId::new(7)),
        JobTarget::Question(QuestionId::new(7)),
    ];
    for target in &all {
        match target {
            JobTarget::Source(_)
            | JobTarget::Document(_)
            | JobTarget::Session(_)
            | JobTarget::Message(_)
            | JobTarget::Artifact(_)
            | JobTarget::Question(_) => {}
        }
    }
    all
}

#[test]
fn every_target_round_trips_through_its_column() -> Result<()> {
    let (_dir, db) = crate::db::Database::temporary()?;
    // The subjects don't exist; this checks the mapping, not the references.
    db.connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let targets = one_of_each();
    assert_eq!(targets.len(), JobTarget::COLUMNS.len());
    for (target, column) in targets.into_iter().zip(JobTarget::COLUMNS) {
        assert_eq!(
            target.column(),
            (column, 7),
            "{target:?} is read from its column"
        );
        let id = db.enqueue_job(&NewJob::new(JobKind::Extract, target))?;
        assert_eq!(db.job(id)?.unwrap().target, target);
        let on_target: Vec<JobId> = db.jobs_for(target)?.iter().map(|job| job.id).collect();
        assert_eq!(on_target, [id], "{target:?}");
    }
    let overviews = db.list_job_overviews(10)?;
    let listed: Vec<JobTarget> = overviews.iter().rev().map(|o| o.job.target).collect();
    assert_eq!(listed, one_of_each());
    Ok(())
}

#[test]
fn every_target_has_exactly_its_own_accessor() {
    for target in one_of_each() {
        let ids = [
            target.source().map(|id| id.get()),
            target.document().map(|id| id.get()),
            target.session().map(|id| id.get()),
            target.message().map(|id| id.get()),
            target.artifact().map(|id| id.get()),
            target.question().map(|id| id.get()),
        ];
        let (column, _) = target.column();
        let expected = JobTarget::COLUMNS.map(|c| (c == column).then_some(7));
        assert_eq!(ids, expected, "{target:?}");
    }
}

#[test]
fn the_schema_has_a_column_index_and_check_for_every_target() {
    let schema = crate::db::migrations::INITIAL;
    let jobs = &schema[schema.find("CREATE TABLE jobs (").unwrap()..];
    let jobs = &jobs[..jobs.find("\n)").unwrap()];
    let columns: Vec<&str> = JOB_COLUMNS.split(',').map(str::trim).collect();
    assert_eq!(columns.len(), JOB_WIDTH);
    for (at, column) in JobTarget::COLUMNS.into_iter().enumerate() {
        let subject = column.strip_suffix("_id").unwrap();
        assert_eq!(columns[JOB_TARGET_AT + at], format!("j.{column}"));
        assert!(
            jobs.contains(&format!("{column} INTEGER REFERENCES ")),
            "jobs.{column} is a reference"
        );
        assert!(
            jobs.contains(&format!("({column} IS NOT NULL)")),
            "jobs.{column} is in the one-target CHECK"
        );
        assert!(
            schema.contains(&format!(
                "CREATE INDEX jobs_{subject}_idx ON jobs ({column});"
            )),
            "jobs.{column} has an index"
        );
    }
    let one_target = &jobs[jobs.find("CHECK ((source_id IS NOT NULL)").unwrap()..];
    let one_target = &one_target[..one_target.find("= 1)").unwrap()];
    assert_eq!(
        one_target.matches(" IS NOT NULL)").count(),
        JobTarget::COLUMNS.len(),
        "the one-target CHECK names exactly the target columns"
    );
}

/// The SQL status lists say the same as [`JobStatus`].
#[test]
fn status_lists_match_the_job_status_enum() {
    fn list(statuses: impl Iterator<Item = JobStatus>) -> String {
        let codes: Vec<String> = statuses.map(|s| format!("'{}'", s.code())).collect();
        format!("({})", codes.join(", "))
    }
    let all = JobStatus::ALL.iter().copied();
    assert_eq!(PENDING, list(all.clone().filter(|s| s.is_pending())));
    assert_eq!(
        NOT_STARTED,
        list(all.filter(|s| {
            matches!(
                s,
                JobStatus::Blocked | JobStatus::Queued | JobStatus::Waiting
            )
        }))
    );
    // The dedupe index covers exactly the jobs not started.
    assert!(crate::db::migrations::INITIAL.contains(&format!(
        "ON jobs (dedupe_key)\n    WHERE status IN {NOT_STARTED};"
    )));
}

/// A source made from `bytes`, named `name`.
fn source_from(db: &Database, dir: &std::path::Path, name: &str, bytes: &[u8]) -> Result<SourceId> {
    let file = dir.join(name);
    std::fs::write(&file, bytes)?;
    Ok(db.import_source(&file, None)?.id)
}

/// Queues `job`, runs it and fails it with `kind`, with no retry; returns it as it ended.
fn fail_once(db: &Database, job: &NewJob, kind: ErrorKind) -> Result<Job> {
    let id = db.enqueue_job(job)?;
    assert_eq!(db.claim_job(&[job.kind])?.unwrap().id, id);
    db.fail_job(id, &Failure::new(kind, "not set up"), None)?;
    Ok(db.job(id)?.unwrap())
}

/// A session's title job, which runs on the language models.
fn title(db: &Database) -> Result<NewJob> {
    let project = db.create_project("Biology")?;
    let session = db.create_session(project.id, "Cells")?;
    Ok(NewJob::new(JobKind::Title, JobTarget::Session(session.id)))
}

#[test]
fn a_reply_that_needs_a_sign_in_waits_for_the_language_models() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let session = db.create_session(project.id, "Cells")?;
    let message = db.post_message(
        session.id,
        MessageRole::User,
        &[NewPart::Text("What is mitosis?".into())],
        &|_, _| false,
    )?;
    let reply = NewJob::new(JobKind::Reply, JobTarget::Message(message.id));
    let waiting = fail_once(&db, &reply, ErrorKind::Config)?;
    assert_eq!(
        (waiting.status, waiting.waiting_for, waiting.needs),
        (
            JobStatus::Waiting,
            Some(Requirement::LanguageModels),
            Some(Requirement::LanguageModels)
        )
    );
    assert_eq!(
        waiting.error_kind,
        Some(ErrorKind::Config),
        "the reason is kept"
    );
    assert_eq!(waiting.finished_at, None, "it has not ended");
    Ok(())
}

#[test]
fn a_read_waits_for_what_its_extractor_needs() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let audio = source_from(&db, dir.path(), "lecture.mp3", b"ID3")?;
    let pdf = source_from(&db, dir.path(), "slides.pdf", b"%PDF-1.7")?;
    let heard = fail_once(&db, &extract(audio), ErrorKind::ModelUnavailable)?;
    assert_eq!(heard.waiting_for, Some(Requirement::Transcription));
    let read = fail_once(&db, &extract(pdf), ErrorKind::Config)?;
    assert_eq!(read.waiting_for, Some(Requirement::LanguageModels));
    Ok(())
}

#[test]
fn a_read_waits_by_the_plan_the_user_chose() -> Result<()> {
    use crate::processing::{ExtractorKind, ProcessingPreferences, Processor};
    let (dir, db) = Database::temporary()?;
    let pdf = source_from(&db, dir.path(), "slides.pdf", b"%PDF-1.7")?;
    let vision = Processor::Extractor(ExtractorKind::Vision);
    ProcessingPreferences::save_switch(&db, SourceKind::Pdf, vision, false)?;
    // Nothing in its plan needs the language models, so nothing set up there would help.
    let read = fail_once(&db, &extract(pdf), ErrorKind::Config)?;
    assert_eq!((read.status, read.waiting_for), (JobStatus::Failed, None));
    Ok(())
}

#[test]
fn work_that_needs_nothing_set_up_fails() -> Result<()> {
    let (_dir, db, source) = database()?;
    for kind in [JobKind::Index, JobKind::Fetch] {
        let job = NewJob::new(kind, JobTarget::Source(source));
        let failed = fail_once(&db, &job, ErrorKind::Config)?;
        assert_eq!(
            (failed.status, failed.waiting_for),
            (JobStatus::Failed, None)
        );
    }
    Ok(())
}

#[test]
fn a_hiccup_is_retried_rather_than_waited_out() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let job = title(&db)?;
    let id = db.enqueue_job(&job)?;
    db.claim_job(&[JobKind::Title])?;
    let later = unix_timestamp() + 60;
    db.fail_job(id, &Failure::new(ErrorKind::Auth, "expired"), Some(later))?;
    let queued = db.job(id)?.unwrap();
    assert_eq!(
        (queued.status, queued.waiting_for),
        (JobStatus::Queued, None)
    );
    Ok(())
}

#[test]
fn work_waiting_twice_leaves_the_waiting_to_the_twin() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let job = title(&db)?;
    let first = db.enqueue_job(&job)?;
    db.claim_job(&[JobKind::Title])?;
    let second = db.enqueue_job(&job)?;
    let after = db.enqueue_job(
        &NewJob::new(
            JobKind::Embed,
            JobTarget::Session(job.target.session().unwrap()),
        )
        .after([first]),
    )?;
    db.claim_job(&[JobKind::Title])?;
    let signed_out = Failure::new(ErrorKind::Config, "nobody signed in");
    db.fail_job(second, &signed_out, None)?;
    assert_eq!(db.job(second)?.unwrap().status, JobStatus::Waiting);
    db.fail_job(first, &signed_out, None)?;
    assert_eq!(db.job(first)?.unwrap().status, JobStatus::Failed);
    let blocked = db.job(after)?.unwrap();
    assert_eq!(
        (blocked.status, blocked.needs),
        (JobStatus::Blocked, Some(Requirement::LanguageModels)),
        "it waits on the twin now"
    );
    // The same work asked for again is the waiting job.
    assert_eq!(db.enqueue_job(&job)?, second);
    Ok(())
}

#[test]
fn setting_something_up_starts_only_the_work_waiting_for_it() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let named = fail_once(&db, &title(&db)?, ErrorKind::Auth)?;
    let audio = source_from(&db, dir.path(), "lecture.mp3", b"ID3")?;
    let heard = fail_once(&db, &extract(audio), ErrorKind::ModelUnavailable)?;
    assert_eq!(db.release_waiting(Requirement::LanguageModels)?, 1);
    let queued = db.job(named.id)?.unwrap();
    assert_eq!(
        (
            queued.status,
            queued.waiting_for,
            queued.error_kind,
            queued.attempts
        ),
        (JobStatus::Queued, None, None, 0)
    );
    assert_eq!(db.job(heard.id)?.unwrap().status, JobStatus::Waiting);
    assert_eq!(db.release_waiting(Requirement::LanguageModels)?, 0);
    Ok(())
}

#[test]
fn setup_does_not_release_waiting_work_before_a_new_dependency() -> Result<()> {
    let (_dir, db, source) = database()?;
    let job = NewJob::new(JobKind::Title, JobTarget::Source(source));
    let waiting = fail_once(&db, &job, ErrorKind::Config)?;
    let dependency = db.enqueue_job(&extract(source))?;

    assert_eq!(db.enqueue_job(&job.after([dependency]))?, waiting.id);
    db.release_waiting(Requirement::LanguageModels)?;
    assert_eq!(db.job(waiting.id)?.unwrap().status, JobStatus::Blocked);
    assert_eq!(db.claim_job(&[JobKind::Title])?, None);

    assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, dependency);
    db.succeed_job(dependency, &[])?;
    assert_eq!(db.job(waiting.id)?.unwrap().status, JobStatus::Queued);
    Ok(())
}

#[test]
fn work_blocked_behind_a_waiting_job_needs_what_it_waits_for() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let audio = source_from(&db, dir.path(), "lecture.mp3", b"ID3")?;
    let read = fail_once(&db, &extract(audio), ErrorKind::ModelUnavailable)?;
    let index =
        db.enqueue_job(&NewJob::new(JobKind::Index, JobTarget::Source(audio)).after([read.id]))?;
    let embed =
        db.enqueue_job(&NewJob::new(JobKind::Embed, JobTarget::Source(audio)).after([index]))?;
    for id in [index, embed] {
        let blocked = db.job(id)?.unwrap();
        assert_eq!(
            (blocked.status, blocked.waiting_for, blocked.needs),
            (JobStatus::Blocked, None, Some(Requirement::Transcription))
        );
    }

    db.release_waiting(Requirement::Transcription)?;
    assert_eq!(db.job(index)?.unwrap().needs, None);
    for (kind, id) in [
        (JobKind::Extract, read.id),
        (JobKind::Index, index),
        (JobKind::Embed, embed),
    ] {
        assert_eq!(db.claim_job(&[kind])?.unwrap().id, id);
        assert!(db.succeed_job(id, &[])?);
    }
    Ok(())
}

#[test]
fn a_waiting_job_can_be_stopped_and_is_not_restarted_on_launch() -> Result<()> {
    let (_dir, db) = Database::temporary()?;
    let job = title(&db)?;
    let waiting = fail_once(&db, &job, ErrorKind::Config)?;
    assert_eq!(db.requeue_interrupted_jobs()?, 0);
    assert_eq!(db.job(waiting.id)?.unwrap().status, JobStatus::Waiting);
    // A chat that only waits for a sign-in is not busy.
    assert_eq!(
        db.sessions_with_pending(JobKind::Title)?,
        Vec::<SessionId>::new()
    );
    assert!(db.cancel_job(waiting.id)?);
    let cancelled = db.job(waiting.id)?.unwrap();
    assert_eq!(
        (cancelled.status, cancelled.waiting_for),
        (JobStatus::Cancelled, None)
    );
    Ok(())
}
