//! Records the demo GIF in the README: `just demo`.
//!
//! The binary starts a private headless desktop (its own sway under `target/showcase`, never
//! the shared one from `just desktop`), seeds a fresh database with the sample data, opens
//! the already-built `study` app on it and waits until it is ready. Then it records the
//! screen while [`tour`] plays a scripted visit, and [`encode`] turns the recording into a
//! looping GIF. No model runs and nobody signs in: every result on screen comes from the
//! seed. Everything it starts is stopped on every exit path.
//!
//! Not `just showcase`, which converts a clip for a pull request: this makes the README's
//! GIF from nothing.
//!
//! `main.rs` only calls [`run`].

#![allow(clippy::print_stderr)] // A command-line tool: printing is its output.

pub mod desktop;
pub mod encode;
pub mod tour;

use std::{
    os::unix::process::CommandExt as _,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

use study_core::{Context as _, Result};

/// Where the GIF goes when no path is given.
const DEFAULT_OUTPUT: &str = "assets/demo.gif";

/// Records the GIF: the one command-line argument, if any, is where it goes.
pub fn run() -> Result<()> {
    let repo = repo_root();
    let work = repo.join("target/showcase");
    let data = work.join("data");
    isolate(&data, &work.join("cache"))?;

    let output = std::env::args_os()
        .nth(1)
        .map_or_else(|| repo.join(DEFAULT_OUTPUT), PathBuf::from);
    let app = std::env::current_exe()?
        .parent()
        .context("the showcase binary has no directory")?
        .join("study");
    if !app.is_file() {
        return Err(study_core::Error::msg(format!(
            "{} is missing: build it first with `cargo build -p study`",
            app.display()
        )));
    }

    let database = seed(&data)?;
    let desktop = desktop::Desktop::start(&repo, &work)?;
    let mut app = desktop.launch(&app, &work)?;
    desktop.wait_until_ready(&mut app, &work)?;
    wait_for_indexing(&database, &mut app, &work)?;
    eprintln!("ready; recording");

    let raw = work.join("tour.mkv");
    let mut recording = desktop.record(&raw, &work.join("recorder.log"))?;
    thread::sleep(desktop::FIRST_FRAME);
    recording.check_running()?;
    let steps = tour::tour();
    eprintln!(
        "tour of about {:.0} s",
        tour::estimate(&steps).as_secs_f64()
    );
    let played = tour::play(&desktop, &steps, || app.check_running(&work));
    recording.stop(&desktop)?;
    played?;
    app.check_running(&work)?; // never encode what the app's exit cut short

    let size = encode::gif(&raw, &output)?;
    eprintln!("wrote {} ({size} bytes)", output.display());
    Ok(())
}

/// Makes sure the app and the seed find their files under `data` and `cache`, and never the
/// real ones: the app and the seed locate them through two variables, so if they are not
/// ours, this process starts again with ours.
fn isolate(data: &Path, cache: &Path) -> Result<()> {
    if std::env::var_os("XDG_DATA_HOME").as_deref() != Some(data.as_os_str()) {
        let error = Command::new(std::env::current_exe()?)
            .args(std::env::args_os().skip(1))
            .env("XDG_DATA_HOME", data)
            .env("XDG_CACHE_HOME", cache)
            .exec();
        return Err(error.into());
    }
    Ok(())
}

/// Fills a new database under `data` with the showcase sample, and returns its path.
fn seed(data: &Path) -> Result<PathBuf> {
    std::fs::remove_dir_all(data).ok();
    let path = study_core::db::Database::default_path()?;
    study_core::db::Database::open(&path)?.seed_showcase()?;
    eprintln!("seeded {}", path.display());
    Ok(path)
}

/// Waits until the app has indexed what was seeded, so the search in the tour finds it. The
/// database is the truth: the app queues the indexing at start and finishes it in the
/// background.
fn wait_for_indexing(database: &Path, app: &mut desktop::Guard, work: &Path) -> Result<()> {
    use study_core::{JobKind, JobStatus};
    let log = work.join("app.log");
    let store = study_core::db::Database::open(database)?;
    desktop::wait(Duration::from_secs(300), "the app to index", || {
        app.check_running(work)?;
        let jobs = store.list_job_overviews(1000)?;
        let index = || {
            jobs.iter()
                .filter(|overview| overview.job.kind == JobKind::Index)
        };
        if let Some(overview) =
            index().find(|o| matches!(o.job.status, JobStatus::Failed | JobStatus::Cancelled))
        {
            return Err(study_core::Error::msg(format!(
                "indexing job {:?} for {:?} ended {:?}; see {}",
                overview.job.kind,
                overview.subject,
                overview.job.status,
                log.display()
            )));
        }
        let waiting =
            index().any(|o| matches!(o.job.status, JobStatus::Queued | JobStatus::Running));
        Ok((!waiting && !jobs.is_empty()).then_some(()))
    })
}

/// The repository, two levels above this crate.
fn repo_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| manifest.to_owned())
}
