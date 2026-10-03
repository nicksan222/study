//! What the app's tests share: an app on a temporary database, a text extractor that never
//! loads a model, and an app whose language models are a mock. Each test uses some of it.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use study_ai::chat::ModelsConfig;
use study_ai::testing::{self, RESPONSES_PATH, signed_in};
use study_app::pipeline::ExtractorSet;
use study_app::views::{
    Anchor, Block, BlockKind, ChatSession, Document, Job, JobKind, JobStatus, Place, Source,
};
use study_app::{App, WorkerSetup};
use study_core::db::Store;
use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};
use study_core::{ErrorKind, Failure, ProjectId, Requirement, SessionId};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, Request};

/// Reads text files back uppercased, one block per line, as the text extractor; `fail` in
/// a file fails it.
pub struct Shout;

impl Extractor for Shout {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Text
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async move {
            let text = String::from_utf8_lossy(&input.bytes).to_uppercase();
            if text.contains("FAIL") {
                return Err(Failure::new(ErrorKind::InvalidInput, "asked to fail"));
            }
            let blocks = text
                .lines()
                .enumerate()
                .map(|(index, line)| Block {
                    kind: BlockKind::Paragraph,
                    text: line.to_owned(),
                    anchor: Anchor::Text {
                        line_start: index as u32 + 1,
                        line_end: index as u32 + 1,
                        start: 0,
                        end: 0,
                    },
                })
                .collect();
            Ok(Document {
                blocks,
                ..Document::default()
            })
        })
    }
}

/// The [`Shout`] extractor, alone.
pub fn shout() -> ExtractorSet {
    ExtractorSet::new(vec![Arc::new(Shout)])
}

/// An app on a new database in `dir`, before background work starts.
pub fn open(dir: &tempfile::TempDir) -> study_core::Result<App> {
    App::open(database(dir))
}

/// Starts `app`'s background work reading with [`Shout`], and no search model.
pub fn start(app: &App) -> study_core::Result<()> {
    app.start_workers_with(WorkerSetup::testing(shout()))
}

/// An app on a new database in `dir`, reading with `extractors` and no search model.
pub fn started(dir: &tempfile::TempDir, extractors: ExtractorSet) -> study_core::Result<App> {
    let app = open(dir)?;
    app.start_workers_with(WorkerSetup::testing(extractors))?;
    Ok(app)
}

/// The database of an app in `dir`, opened on its own, without an app.
pub fn store(dir: &tempfile::TempDir) -> study_core::Result<Store> {
    Store::open(database(dir))
}

/// Where the database of an app in `dir` lives.
pub fn database(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("study.sqlite3")
}

/// Writes a file named `name` holding `contents` in `dir`, for importing.
pub fn write(dir: &tempfile::TempDir, name: &str, contents: &str) -> study_core::Result<PathBuf> {
    let path = dir.path().join(name);
    std::fs::write(&path, contents)?;
    Ok(path)
}

/// Whether some job of `kind` has succeeded.
pub fn succeeded(app: &App, kind: JobKind) -> study_core::Result<bool> {
    Ok(app
        .job_overviews(20)?
        .iter()
        .any(|overview| overview.job.kind == kind && overview.job.status == JobStatus::Succeeded))
}

/// Runs `check` until it holds, failing the test after a timeout.
pub fn eventually(mut check: impl FnMut() -> study_core::Result<bool>) -> study_core::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !check()? {
        assert!(Instant::now() < deadline, "timed out");
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

/// Waits until the latest job of `kind` waits for `requirement`, and returns it.
pub fn waiting(app: &App, kind: JobKind, requirement: Requirement) -> study_core::Result<Job> {
    let last = || -> study_core::Result<Option<Job>> {
        Ok(app
            .job_overviews(50)?
            .into_iter()
            .find(|overview| overview.job.kind == kind)
            .map(|overview| overview.job))
    };
    eventually(|| {
        Ok(last()?.is_some_and(|job| {
            job.status == JobStatus::Waiting && job.waiting_for == Some(requirement)
        }))
    })?;
    Ok(last()?.expect("the job exists"))
}

/// An app whose language models run on a mock of the ChatGPT plan API, signed in, with the
/// [`Shout`] extractor.
pub struct Fixture {
    pub dir: tempfile::TempDir,
    pub app: App,
    pub project: ProjectId,
    pub model: MockServer,
}

impl Fixture {
    pub async fn start() -> study_core::Result<Self> {
        let dir = tempfile::tempdir()?;
        let app = open(&dir)?;
        let project = app.create_project("Biology")?.id;
        // Sessions are shared per account across the process; each fixture signs in its own.
        let (model, plan) = signed_in().await;
        app.start_workers_with(
            WorkerSetup::testing(shout()).with_models(ModelsConfig::from_fn(|_| plan.clone())),
        )?;
        Ok(Self {
            dir,
            app,
            project,
            model,
        })
    }

    /// Makes the model answer `answer` to the agent whose instructions contain `agent`.
    pub async fn answer(&self, agent: &str, answer: &str) {
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .and(body_string_contains(agent))
            .respond_with(testing::answer(answer))
            .mount(&self.model)
            .await;
    }

    /// Makes the model answer `answer` to the agent whose instructions contain `agent` when
    /// its prompt also contains `when`, over what [`answer`](Self::answer) set for it.
    pub async fn answer_when(&self, agent: &str, when: &str, answer: &str) {
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .and(body_string_contains(agent))
            .and(body_string_contains(when))
            .respond_with(testing::answer(answer))
            .with_priority(1)
            .mount(&self.model)
            .await;
    }

    /// Posts a message with text files named and filled as given.
    pub async fn post(
        &self,
        place: impl Into<Place>,
        text: &str,
        files: &[(&str, &str)],
    ) -> study_core::Result<()> {
        let paths = files
            .iter()
            .map(|(name, contents)| write(&self.dir, name, contents))
            .collect::<study_core::Result<Vec<_>>>()?;
        let text = text.to_owned();
        let place = place.into();
        self.blocking(move |app| app.post_message(place, &text, &paths))
            .await?;
        Ok(())
    }

    /// Writes a text file named `name` and imports it into the project; it is read by the
    /// [`Shout`] extractor, uppercased.
    pub async fn import(&self, name: &str, contents: &str) -> study_core::Result<Source> {
        let path = write(&self.dir, name, contents)?;
        let project = self.project;
        self.blocking(move |app| app.import_file(&path, Some(project)))
            .await
    }

    /// Runs `work` on the app off the async workers, as the UI does: `App`'s methods block.
    pub async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&App) -> study_core::Result<T> + Send + 'static,
    ) -> study_core::Result<T> {
        let app = self.app.clone();
        tokio::task::spawn_blocking(move || work(&app)).await?
    }

    pub fn session(&self, id: SessionId) -> study_core::Result<ChatSession> {
        Ok(self.app.session(id)?.expect("the session exists"))
    }

    /// Waits until the latest job of `kind` has ended, and returns it.
    pub async fn finished(&self, kind: JobKind) -> study_core::Result<Job> {
        self.blocking(move |app| {
            let last = || -> study_core::Result<Option<Job>> {
                Ok(app
                    .job_overviews(50)?
                    .into_iter()
                    .find(|overview| overview.job.kind == kind)
                    .map(|overview| overview.job))
            };
            eventually(|| Ok(last()?.is_some_and(|job| job.status.is_terminal())))?;
            Ok(last()?.expect("the job exists"))
        })
        .await
    }

    /// Waits until the latest job of `kind` waits for `requirement`, and returns it.
    pub async fn waiting(
        &self,
        kind: JobKind,
        requirement: Requirement,
    ) -> study_core::Result<Job> {
        self.blocking(move |app| waiting(app, kind, requirement))
            .await
    }

    /// The prompts the agent whose instructions contain `agent` sent, oldest first.
    pub async fn prompts(&self, agent: &str) -> Vec<String> {
        let requests: Vec<Request> = self.model.received_requests().await.unwrap_or_default();
        requests
            .iter()
            .filter(|request| request.url.path() == RESPONSES_PATH)
            .map(|request| {
                let body: Value = request.body_json().unwrap();
                format!("{}{}", body["instructions"], body["input"])
            })
            .filter(|prompt| prompt.contains(agent))
            .collect()
    }
}
