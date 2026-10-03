//! The engine against a scripted processor: runs, follow-ups, failures, retries,
//! cancelling, and jobs resumed after a restart.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use super::worker::{FIRST_RETRY, LONGEST_RETRY, retry_delay};
use super::*;
use crate::bus::{Heard, Listener};
use crate::db::JobTarget;
use crate::{ErrorKind, JobStatus, SourceId};

/// Succeeds, fails, panics, hangs or chains, as the job's arguments say.
struct Scripted {
    kind: JobKind,
    runs: AtomicU32,
}

impl JobHandler for Scripted {
    fn kind(&self) -> JobKind {
        self.kind
    }

    fn lane(&self) -> Lane {
        Lane::Light
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        let run = self.runs.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            let script = job
                .args
                .as_ref()
                .and_then(|args| args.as_str())
                .unwrap_or("ok");
            match script {
                "ok" => Ok(Vec::new()),
                "chain" => Ok(vec![NewJob::new(JobKind::Index, job.target)]),
                "fail" => Err(Failure::new(ErrorKind::Unsupported, "cannot read it")),
                "flaky" if run == 0 => Err(Failure::new(ErrorKind::Transient, "offline")),
                "flaky" => Ok(Vec::new()),
                "panic" => panic!("asked to panic"),
                "hang" => std::future::pending().await,
                other => panic!("unknown script {other}"),
            }
        })
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    store: Store,
    runtime: tokio::runtime::Runtime,
    source: SourceId,
}

impl Fixture {
    fn new() -> Result<Self> {
        let (dir, store) = Store::temporary()?;
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "notes")?;
        let source = store
            .with(|database| database.import_source(&path, None))?
            .id;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()?;
        Ok(Self {
            _dir: dir,
            store,
            runtime,
            source,
        })
    }

    fn start(&self, kinds: &[JobKind]) -> Result<(Jobs, Listener<JobEvent>)> {
        let bus = EventBus::new();
        let events = bus.listen::<Job>();
        let handlers = kinds
            .iter()
            .map(|&kind| {
                Arc::new(Scripted {
                    kind,
                    runs: AtomicU32::new(0),
                }) as Arc<dyn JobHandler>
            })
            .collect();
        let jobs = Jobs::start(
            self.store.clone(),
            handlers,
            bus,
            self.runtime.handle().clone(),
        )?;
        Ok((jobs, events))
    }

    fn job(&self, script: &str) -> NewJob {
        NewJob::new(JobKind::Extract, JobTarget::Source(self.source))
            .with_args(serde_json::json!(script))
    }

    fn status(&self, id: JobId) -> Result<JobStatus> {
        Ok(self
            .store
            .with(|database| database.job(id))?
            .expect("the job")
            .status)
    }
}

/// Waits until the job reaches `status`.
fn wait_for(fixture: &Fixture, id: JobId, status: JobStatus) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while fixture.status(id).ok() != Some(status) {
        assert!(Instant::now() < deadline, "timed out waiting for {status}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_job_runs_and_announces_each_step() -> Result<()> {
    let fixture = Fixture::new()?;
    let (jobs, mut events) = fixture.start(&[JobKind::Extract])?;
    let id = jobs.enqueue(&fixture.job("ok"))?;
    wait_for(&fixture, id, JobStatus::Succeeded);
    let mut seen = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !seen.contains(&JobStatus::Succeeded) && Instant::now() < deadline {
        match events.try_next() {
            Some(Heard::Event(JobEvent::Changed { status, job_id, .. })) if job_id == id => {
                seen.push(status);
            }
            Some(_) => {}
            None => std::thread::sleep(Duration::from_millis(5)),
        }
    }
    assert_eq!(seen.first(), Some(&JobStatus::Queued));
    assert!(seen.contains(&JobStatus::Succeeded));
    Ok(())
}

#[test]
fn followups_run_after_their_job() -> Result<()> {
    let fixture = Fixture::new()?;
    let (jobs, _events) = fixture.start(&[JobKind::Extract, JobKind::Index])?;
    let id = jobs.enqueue(&fixture.job("chain"))?;
    wait_for(&fixture, id, JobStatus::Succeeded);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let done = fixture.store.with(|database| {
            Ok(database.list_job_overviews(10)?.iter().any(|overview| {
                overview.job.kind == JobKind::Index && overview.job.status == JobStatus::Succeeded
            }))
        })?;
        if done {
            break;
        }
        assert!(Instant::now() < deadline, "the follow-up never ran");
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

#[test]
fn a_failure_keeps_its_kind_and_a_panic_is_a_failure() -> Result<()> {
    let fixture = Fixture::new()?;
    let (jobs, _events) = fixture.start(&[JobKind::Extract])?;
    let failed = jobs.enqueue(&fixture.job("fail"))?;
    wait_for(&fixture, failed, JobStatus::Failed);
    let job = fixture
        .store
        .with(|database| database.job(failed))?
        .unwrap();
    assert_eq!(job.error_kind, Some(ErrorKind::Unsupported));

    let panicked = jobs.enqueue(&fixture.job("panic"))?;
    wait_for(&fixture, panicked, JobStatus::Failed);
    let job = fixture
        .store
        .with(|database| database.job(panicked))?
        .unwrap();
    assert_eq!(job.error_kind, Some(ErrorKind::Internal));
    assert!(jobs.retry(panicked)?);
    Ok(())
}

#[test]
fn a_transient_failure_is_retried_later() -> Result<()> {
    let fixture = Fixture::new()?;
    let (jobs, _events) = fixture.start(&[JobKind::Extract])?;
    let id = jobs.enqueue(&fixture.job("flaky"))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let job = fixture.store.with(|database| database.job(id))?.unwrap();
        if job.status == JobStatus::Queued && job.error_kind == Some(ErrorKind::Transient) {
            break;
        }
        assert!(Instant::now() < deadline, "never scheduled a retry");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(retry_delay(1, None), FIRST_RETRY);
    assert_eq!(retry_delay(3, None), FIRST_RETRY * 4);
    assert_eq!(
        retry_delay(1, Some(Duration::from_secs(30))),
        Duration::from_secs(30)
    );
    assert_eq!(retry_delay(20, None), LONGEST_RETRY);
    Ok(())
}

#[test]
fn cancelling_a_running_job_stops_it_without_the_bus() -> Result<()> {
    let fixture = Fixture::new()?;
    let (jobs, _events) = fixture.start(&[JobKind::Extract])?;
    let id = jobs.enqueue(&fixture.job("hang"))?;
    wait_for(&fixture, id, JobStatus::Running);
    assert!(jobs.cancel(id)?);
    assert_eq!(fixture.status(id)?, JobStatus::Cancelled);
    // The lane is free again.
    let next = jobs.enqueue(&fixture.job("ok"))?;
    wait_for(&fixture, next, JobStatus::Succeeded);
    Ok(())
}

#[test]
fn jobs_left_running_resume_on_start() -> Result<()> {
    let fixture = Fixture::new()?;
    let id = fixture.store.with(|database| {
        let id = database.enqueue_job(&fixture.job("ok"))?;
        database.claim_job(&[JobKind::Extract])?;
        Ok(id)
    })?;
    let (_jobs, _events) = fixture.start(&[JobKind::Extract])?;
    wait_for(&fixture, id, JobStatus::Succeeded);
    Ok(())
}

/// A claim still waiting for the database as its engine stops takes nothing, not even work
/// that became due meanwhile, as the next start would queue: nothing would ever run it.
#[test]
fn a_claim_waiting_as_the_engine_stops_takes_nothing() -> Result<()> {
    let fixture = Fixture::new()?;
    // Queued, but not due for an hour, so the lane finds nothing to claim at first.
    let id = fixture.store.with(|database| {
        let id = database.enqueue_job(&fixture.job("ok"))?;
        database.claim_job(&[JobKind::Extract])?;
        let later = crate::db::unix_timestamp() + 3_600;
        database.fail_job(
            id,
            &Failure::new(ErrorKind::Transient, "offline"),
            Some(later),
        )?;
        Ok(id)
    })?;
    let (jobs, _events) = fixture.start(&[JobKind::Extract])?;
    // Another connection holds the write lock, so the lane's next claim waits for it.
    let other = crate::db::Database::open(fixture.store.path())?;
    other.connection.execute_batch("BEGIN IMMEDIATE")?;
    jobs.wake();
    std::thread::sleep(Duration::from_millis(200));
    jobs.stop();
    drop(jobs);
    other.connection.execute(
        "UPDATE jobs SET run_after = 0 WHERE id = ?1",
        rusqlite::params![id],
    )?;
    other.connection.execute_batch("COMMIT")?;
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(fixture.status(id)?, JobStatus::Queued);
    Ok(())
}
