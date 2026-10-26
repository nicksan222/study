//! Starting background work: the [`Pipeline`] of processors, and the one [`JobHandler`] per
//! [`JobKind`] (see [`handlers`]). Once started, the rest of the app reaches the jobs engine
//! and the pipeline through [`App::running`] and queues work with [`App::queue`] or
//! [`App::queue_reads`]. Work that waited for the workers, a switch or a model is caught up
//! on by the `queue_unread_sources`, `queue_unrefined_reads` and `queue_missing_*` methods.

use std::sync::Arc;

use study_ai::agent::AgentRuntime;
use study_ai::chat::ModelsConfig;
use study_core::db::{Database, JobTarget, NewJob, Readable, Store};
use study_core::jobs::{JobHandler, Jobs};
use study_core::processing::{ProcessingPreferences, plan_for, sources_missing_refiners};
use study_core::{Context as _, Result, err};
use study_core::{DocumentId, ErrorKind, JobKind, Requirement, SourceKind};
use study_pipeline::{EmbedderSlot, ExtractorSet, Pipeline};

use crate::App;
use crate::LocalModel;
use crate::agents::grade::GradeHandler;
use crate::agents::question::QuestionHandler;
use crate::agents::reply::ReplyHandler;
use crate::agents::rewrite::RewriteHandler;
use crate::agents::title::TitleHandler;
use crate::search::Retriever;

/// What background work runs with, instead of what the saved preferences set up.
pub struct WorkerSetup {
    /// `None` reads with the extractors Study ships.
    pub extractors: Option<ExtractorSet>,
    /// Language models; `None` follows the saved preferences.
    pub models: Option<ModelsConfig>,
    /// Whether search by meaning uses the installed search model. Tests turn it off, so they
    /// never load a real model.
    pub search_model: bool,
}

impl WorkerSetup {
    /// `extractors`, language models from the preferences, and no search model: for tests.
    pub fn testing(extractors: ExtractorSet) -> Self {
        Self {
            extractors: Some(extractors),
            models: None,
            search_model: false,
        }
    }

    /// Language models from `models` instead of the preferences.
    pub fn with_models(mut self, models: ModelsConfig) -> Self {
        self.models = Some(models);
        self
    }
}

/// What runs in the background once [`App::start_workers`] is called.
#[derive(Clone)]
pub(crate) struct Workers {
    pub jobs: Jobs,
    pub pipeline: Pipeline,
}

impl App {
    /// Starts background work with the processors the saved preferences set up: reading
    /// sources, indexing them for search, naming sessions, answering the notes that mention the
    /// assistant, writing study material, and writing and grading practice questions. Queued
    /// and interrupted work resumes at once. Does nothing when already started.
    pub fn start_workers(&self) -> Result<()> {
        self.start_workers_with(WorkerSetup {
            extractors: None,
            models: None,
            search_model: true,
        })
    }

    /// Like [`start_workers`](Self::start_workers), set up as `setup` says; for test doubles.
    pub fn start_workers_with(&self, setup: WorkerSetup) -> Result<()> {
        let WorkerSetup {
            extractors,
            models,
            search_model,
        } = setup;
        let mut workers = self
            .inner
            .workers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if workers.is_some() {
            return Ok(());
        }
        let store = self.store()?.clone();
        if !search_model {
            self.inner.embedder.turn_off();
        }
        let agents = match models {
            Some(config) => AgentRuntime::fixed(store.clone(), config),
            None => AgentRuntime::saved(store.clone()),
        };
        let mut pipeline = Pipeline::builtin(store.clone(), &agents, self.inner.embedder.clone());
        if let Some(extractors) = extractors {
            pipeline = pipeline.with_extractors(extractors);
        }
        let jobs = Jobs::start(
            store.clone(),
            handlers(&store, &pipeline, &self.inner.embedder, agents.clone()),
            self.inner.bus.clone(),
            self.inner.handle.clone(),
        )
        .context("cannot start background work")?;
        let started = Workers { jobs, pipeline };
        *workers = Some(started.clone());
        drop(workers);
        // Work that stopped between steps, or waited for work to start, is queued now.
        self.queue_unread_sources()?;
        self.queue_missing_passages()?;
        self.queue_missing_embeddings()?;
        if self.model_installed(LocalModel::Transcription) {
            self.release_waiting(Requirement::Transcription)?;
            self.retry_failed(&[JobKind::Extract], &[ErrorKind::ModelUnavailable])?;
        }
        // Only now and at sign-in, never after a refiner fails, so a model that keeps failing
        // costs one more read per start, not a loop. With no model set up the read would
        // only come out uncorrected again, so nothing is queued.
        if self.with(|database| agents.any_ready(database))? {
            self.retry_language_model_work()?;
        }
        started.jobs.wake();
        Ok(())
    }

    /// Searches by words only from now on, never loading the search model even when it is
    /// installed; for tests, which must not run a real model. [`WorkerSetup::testing`] does
    /// the same for tests that start the workers.
    pub fn turn_off_search_model(&self) {
        self.inner.embedder.turn_off();
    }

    /// Whether background work has started.
    pub fn workers_running(&self) -> bool {
        self.workers().is_some()
    }

    /// The running workers, if started.
    fn workers(&self) -> Option<Workers> {
        self.inner
            .workers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// The running workers, for commands that queue work; an error before they start.
    pub(crate) fn running(&self) -> Result<Workers> {
        self.workers()
            .ok_or_else(|| err!("background work has not started"))
    }

    /// Wakes the workers, when running, to pick up jobs just committed.
    pub(crate) fn wake(&self) {
        if let Some(workers) = self.workers() {
            workers.jobs.wake();
        }
    }

    /// Runs `work`, which queues jobs, then wakes the workers to run them: committed first,
    /// so a wake that comes early loses nothing. An error before background work starts.
    pub(crate) fn queue<T>(&self, work: impl FnOnce(&Database) -> Result<T>) -> Result<T> {
        let workers = self.running()?;
        let queued = self.with(work)?;
        workers.jobs.wake();
        Ok(queued)
    }

    /// What decides whether a source is read now: the user's processing plan, and whether the
    /// running pipeline has an extractor it lists. Nothing is read before work starts.
    pub(crate) fn reader(&self) -> Result<Reader> {
        Ok(Reader {
            processing: self.processing()?,
            pipeline: self.workers().map(|workers| workers.pipeline),
        })
    }

    /// Runs `work`, which stores sources and queues a read of each that `readable` says the
    /// running pipeline reads, then wakes the workers. Before work starts nothing is read
    /// now: those sources are read once it starts.
    pub(crate) fn queue_reads<T>(
        &self,
        work: impl FnOnce(&Database, Readable<'_>) -> Result<T>,
    ) -> Result<T> {
        let reader = self.reader()?;
        let stored =
            self.with(|database| work(database, &|kind, mime| reader.reads(kind, mime)))?;
        self.wake();
        Ok(stored)
    }

    /// Runs `work`, which deletes something, then stops the jobs whose subject went with it
    /// and frees the jobs that waited on them.
    pub(crate) fn delete<T>(&self, work: impl FnOnce(&Database) -> Result<T>) -> Result<T> {
        let deleted = self.with(work)?;
        self.stop_ended()?;
        Ok(deleted)
    }

    /// Stops the jobs a change just ended, deleted or cancelled them in its transaction, and
    /// wakes the workers for what it queued or freed.
    pub(crate) fn stop_ended(&self) -> Result<()> {
        match self.workers() {
            Some(workers) => workers.jobs.stop_ended(),
            None => Ok(()),
        }
    }

    /// Queues a read of every source not read yet that the processing plan reads: those
    /// stored while nothing ran, or whose reading was just switched on.
    pub(crate) fn queue_unread_sources(&self) -> Result<()> {
        if !self.workers_running() {
            return Ok(());
        }
        self.queue_reads(|database, readable| {
            for source in database.unread_sources()? {
                if readable(source.kind, &source.mime) {
                    let job = NewJob::new(JobKind::Extract, JobTarget::Source(source.id));
                    database.enqueue_job(&job)?;
                }
            }
            Ok(())
        })
    }

    /// Queues a read of every source stored waiting for a refiner that needs a language model
    /// and is still switched on: one that failed when it was read, such as a transcript read
    /// before anyone signed in, or while the plan was rate limited, and so left uncorrected.
    /// A refiner that was switched off at the time leaves nothing to catch up, as switching
    /// it on applies from then on. Its bytes are read afresh, as its stamps no longer match.
    pub(crate) fn queue_unrefined_reads(&self) -> Result<()> {
        if !self.workers_running() {
            return Ok(());
        }
        self.queue_reads(|database, readable| {
            for source in sources_missing_refiners(database, Requirement::LanguageModels)? {
                let Some(stored) = database.source(source)? else {
                    continue;
                };
                if readable(stored.kind, &stored.mime) {
                    database
                        .enqueue_job(&NewJob::new(JobKind::Extract, JobTarget::Source(source)))?;
                }
            }
            Ok(())
        })
    }

    /// Queues indexing for documents read whose Index never ran: one stopped just as it
    /// finished reading, or read while the index was switched off.
    pub(crate) fn queue_missing_passages(&self) -> Result<()> {
        self.queue_for_documents(JobKind::Index, |database| {
            database.documents_missing_passages()
        })
    }

    /// Queues embedding for everything the search model has not embedded yet: read before it
    /// was installed, or embedded by another model. Loads the model the first time, to ask
    /// which one it is; a model that does not load is logged and queues nothing, as its
    /// Embed jobs would fail the same way.
    pub(crate) fn queue_missing_embeddings(&self) -> Result<()> {
        let embedder = match self.embedder().get() {
            Ok(Some(embedder)) => embedder,
            Ok(None) => return Ok(()),
            Err(error) => {
                tracing::warn!(
                    error = format!("{error:#}"),
                    "the search model did not load"
                );
                return Ok(());
            }
        };
        self.release_waiting(Requirement::SearchModel)?;
        let model = embedder.model_id();
        self.queue_for_documents(JobKind::Embed, |database| {
            database.documents_missing_embeddings(model)
        })
    }

    /// Queues `stage` for each document `documents` finds whose source's plan includes it,
    /// and wakes the workers.
    fn queue_for_documents(
        &self,
        stage: JobKind,
        documents: impl FnOnce(&Database) -> Result<Vec<DocumentId>>,
    ) -> Result<()> {
        if !self.workers_running() {
            return Ok(());
        }
        self.queue(|database| {
            for document in documents(database)? {
                let target = JobTarget::Document(document);
                if plan_for(database, target)?.is_some_and(|plan| plan.includes(stage)) {
                    database.enqueue_job(&NewJob::new(stage, target))?;
                }
            }
            Ok(())
        })
    }
}

/// Whether sources are read; see [`App::reader`].
pub(crate) struct Reader {
    processing: ProcessingPreferences,
    pipeline: Option<Pipeline>,
}

impl Reader {
    /// Whether a source of this kind and media type is read.
    pub fn reads(&self, kind: SourceKind, mime: &str) -> bool {
        self.pipeline
            .as_ref()
            .is_some_and(|pipeline| pipeline.can_read(&self.processing.plan(kind, mime)))
    }
}

/// Every job handler, one per [`JobKind`]: the pipeline's stages and enhancers, and the
/// conversation and practice agents. A new job kind's handler is added here or to the
/// pipeline; until it is, the test `every_job_kind_has_exactly_one_handler` fails.
fn handlers(
    store: &Store,
    pipeline: &Pipeline,
    embedder: &EmbedderSlot,
    agents: AgentRuntime,
) -> Vec<Arc<dyn JobHandler>> {
    let mut handlers = pipeline.handlers();
    handlers.push(Arc::new(TitleHandler::new(agents.clone())));
    handlers.push(Arc::new(QuestionHandler::new(
        agents.clone(),
        pipeline.sifter().clone(),
    )));
    handlers.push(Arc::new(GradeHandler::new(agents.clone())));
    let retriever = Retriever::new(store.clone(), embedder.clone());
    handlers.push(Arc::new(RewriteHandler::new(
        agents.clone(),
        retriever.clone(),
    )));
    handlers.push(Arc::new(ReplyHandler::new(agents, retriever)));
    handlers
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Forgetting to register a new job kind's handler, or registering one twice, fails here
    /// instead of leaving its jobs queued forever.
    #[test]
    fn every_job_kind_has_exactly_one_handler() {
        let (_dir, store) = Store::temporary().unwrap();
        let agents = AgentRuntime::saved(store.clone());
        let embedder = EmbedderSlot::default();
        let pipeline = Pipeline::builtin(store.clone(), &agents, embedder.clone());
        let mut kinds: Vec<JobKind> = handlers(&store, &pipeline, &embedder, agents)
            .iter()
            .map(|handler| handler.kind())
            .collect();
        kinds.sort_by_key(|kind| kind.code());
        let mut expected = JobKind::ALL.to_vec();
        expected.sort_by_key(|kind| kind.code());
        assert_eq!(kinds, expected);
    }
}
