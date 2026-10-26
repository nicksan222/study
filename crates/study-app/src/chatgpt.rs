//! Signing in to ChatGPT, so the language models can run on the user's own plan.
//!
//! The sign-in happens in the browser: [`App::start_chatgpt_sign_in`] returns the page to
//! open, and [`App::finish_chatgpt_sign_in`] waits for the browser to come back, saves the
//! account, and starts again the work that failed for want of it.

use std::time::Duration;

use study_ai::chat::provider::chatgpt::{self, SignIn};
use study_ai::chat::{ChatGptAccount, ChatGptPreferences};
use study_core::processing::ExtractorKind;
use study_core::{Error, ErrorKind, JobKind, Requirement, Result};

use crate::App;

/// How long the browser has to bring the sign-in back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

impl App {
    /// Starts a sign-in: open [`SignIn::url`] in the browser, then pass the sign-in to
    /// [`Self::finish_chatgpt_sign_in`]. `reconsent` asks the user again to share their plan,
    /// for one who declined the first time.
    pub async fn start_chatgpt_sign_in(&self, reconsent: bool) -> Result<SignIn> {
        let (host, client_id) = self
            .blocking(|app| {
                let mut preferences = app.preferences::<ChatGptPreferences>()?;
                let fresh = preferences.host_id.is_none();
                let host = preferences.host_id();
                if fresh {
                    app.save_preferences(&preferences)?;
                }
                Ok((host, preferences.client_id))
            })
            .await?;
        SignIn::start(chatgpt::ISSUER, &host, client_id.as_deref(), reconsent)
            .await
            .map_err(Error::classified)
    }

    /// Waits for the browser, saves the account, and starts again the titles, answers and
    /// study material that failed because no model was set up or the plan refused the old
    /// sign-in, and the reads stored uncorrected for want of one. A sign-in the user cancels or
    /// leaves fails as [`ErrorKind::Cancelled`].
    pub async fn finish_chatgpt_sign_in(&self, sign_in: SignIn) -> Result<ChatGptAccount> {
        let account = sign_in
            .finish(SIGN_IN_TIMEOUT)
            .await
            .map_err(Error::classified)?;
        let saved = account.clone();
        self.blocking(move |app| {
            let mut preferences = app.preferences::<ChatGptPreferences>()?;
            preferences.client_id = Some(saved.client_id.clone());
            preferences.account = Some(saved);
            app.save_preferences(&preferences)?;
            // Signed in all the same: the work waiting for it starts on the next sign-in or
            // a retry by hand.
            if let Err(error) = app.retry_language_model_work() {
                tracing::warn!(%error, "cannot start again the work that waited for a sign-in");
            }
            Ok(())
        })
        .await?;
        Ok(account)
    }

    /// Signs out: forgets the account here first, then ends its sign-in at OpenAI so Study
    /// leaves the user's connected apps. The registration is kept, so signing in again on
    /// this computer reuses it.
    pub async fn sign_out_chatgpt(&self) -> Result<()> {
        let account = self
            .blocking(|app| {
                let mut preferences = app.preferences::<ChatGptPreferences>()?;
                let account = preferences.account.take();
                app.save_preferences(&preferences)?;
                Ok(account)
            })
            .await?;
        let Some(account) = account else {
            return Ok(());
        };
        if let Err(error) = chatgpt::revoke(chatgpt::ISSUER, &account).await {
            // Signed out here all the same; OpenAI lets the user disconnect Study too.
            tracing::warn!(%error, "cannot end the ChatGPT sign-in at OpenAI");
        }
        Ok(())
    }

    /// Starts again the work on a language model that failed for want of a sign-in: titles,
    /// answers and study material, and reads of pages, which a language model sees. That is
    /// nobody signed in ([`ErrorKind::Config`]) or a sign-in the plan refused
    /// ([`ErrorKind::Auth`]). Reads stored without a refiner that needs one, such as a
    /// transcript left uncorrected because nobody was signed in or the plan was rate
    /// limited, are queued again too, while that refiner is still switched on.
    pub(crate) fn retry_language_model_work(&self) -> Result<()> {
        let mut kinds: Vec<JobKind> = JobKind::ALL
            .iter()
            .copied()
            .filter(|kind| kind.needs_language_model())
            .collect();
        let reads_need_one = ExtractorKind::ALL
            .iter()
            .any(|kind| kind.requirement() == Some(Requirement::LanguageModels));
        if reads_need_one {
            kinds.push(JobKind::Extract);
        }
        self.release_waiting(Requirement::LanguageModels)?;
        self.retry_failed(&kinds, &[ErrorKind::Config, ErrorKind::Auth])?;
        self.queue_unrefined_reads()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;
    use study_ai::agent::unconfigured;
    use study_ai::chat::Tier;

    use study_core::db::{JobTarget, NewJob};
    use study_core::processing::{BoxFuture, Extractor, RefinerKind, SourceInput};
    use study_core::{Anchor, Block, BlockKind, Document, Failure, JobStatus};

    use crate::WorkerSetup;
    use crate::pipeline::ExtractorSet;

    use super::*;

    /// A title written before sign-in failed for want of a model; signing in names it after all.
    #[test]
    fn signing_in_queues_again_the_titles_that_waited_for_a_model() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let app = App::open(dir.path().join("study.sqlite3"))?;
        let project = app.create_project("Biology")?.id;
        let session = app.create_untitled_session(project, "mitochondria")?.id;
        let job = app.with(|database| {
            let id =
                database.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Session(session)))?;
            let claimed = database
                .claim_job(&[JobKind::Title])?
                .expect("the title job");
            database.fail_job(claimed.id, &unconfigured(Tier::Tiny), None)?;
            Ok(id)
        })?;

        app.retry_language_model_work()?;

        let status = app.with(|database| Ok(database.job(job)?.expect("the job").status))?;
        assert_eq!(status, JobStatus::Queued);
        Ok(())
    }

    /// A title the plan refused (its sign-in had ended) is named after signing in again.
    #[test]
    fn signing_in_again_queues_the_titles_the_plan_refused() -> Result<()> {
        use study_ai::chat::provider::chatgpt::PlanError;

        let dir = tempfile::tempdir()?;
        let app = App::open(dir.path().join("study.sqlite3"))?;
        let project = app.create_project("Biology")?.id;
        let session = app.create_untitled_session(project, "mitochondria")?.id;
        let refused = study_ai::chat::Error::Plan(PlanError::Refused {
            status: 401,
            code: None,
            message: "expired".into(),
        });
        assert_eq!(study_core::Classify::kind(&refused), ErrorKind::Auth);
        let job = app.with(|database| {
            let id =
                database.enqueue_job(&NewJob::new(JobKind::Title, JobTarget::Session(session)))?;
            let claimed = database
                .claim_job(&[JobKind::Title])?
                .expect("the title job");
            database.fail_job(claimed.id, &Failure::from(refused), None)?;
            Ok(id)
        })?;

        app.retry_language_model_work()?;

        let status = app.with(|database| Ok(database.job(job)?.expect("the job").status))?;
        assert_eq!(status, JobStatus::Queued);
        Ok(())
    }

    /// Hears every recording as the same words, counting how often it was asked.
    struct Heard(Arc<AtomicUsize>);

    impl Extractor for Heard {
        fn kind(&self) -> ExtractorKind {
            ExtractorKind::Transcription
        }

        fn version(&self) -> u32 {
            1
        }

        fn extract(&self, _: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(Document {
                    blocks: vec![Block {
                        kind: BlockKind::Segment,
                        text: "the krebs cycle".into(),
                        anchor: Anchor::Time {
                            start_ms: 0,
                            end_ms: 1_000,
                        },
                    }],
                    ..Document::default()
                })
            })
        }
    }

    fn eventually(mut check: impl FnMut() -> Result<bool>) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !check()? {
            assert!(Instant::now() < deadline, "timed out");
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }

    /// With nobody signed in a recording is read all the same, uncorrected; signing in reads
    /// it again so its transcript is corrected.
    #[test]
    fn a_transcript_read_before_sign_in_is_read_again_after() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let app = App::open(dir.path().join("study.sqlite3"))?;
        let reads = Arc::new(AtomicUsize::new(0));
        app.start_workers_with(WorkerSetup::testing(ExtractorSet::new(vec![Arc::new(
            Heard(reads.clone()),
        )])))?;
        let path = dir.path().join("lecture.wav");
        std::fs::write(&path, b"RIFF")?;
        let source = app.import_file(&path, None)?.id;

        eventually(|| Ok(extracts(&app, source)? == [JobStatus::Succeeded]))?;
        let document = app.source_document(source)?.expect("read");
        assert_eq!(document.text(), "the krebs cycle");
        assert!(!corrected(&document), "{:?}", document.meta.refiners);
        assert_eq!(document.meta.waiting_for, [RefinerKind::Transcript]);

        app.retry_language_model_work()?;
        eventually(|| Ok(reads.load(Ordering::SeqCst) == 2))?;
        assert_eq!(
            extracts(&app, source)?.len(),
            2,
            "its read was queued again"
        );
        Ok(())
    }

    /// Switching correction back on applies from then on: a recording read while it was off
    /// is not read again for it, at sign-in or at the next start.
    #[test]
    fn a_transcript_read_with_correction_off_is_not_read_again_when_it_is_on() -> Result<()> {
        use study_core::SourceKind;
        use study_core::processing::Processor;

        let dir = tempfile::tempdir()?;
        let database = dir.path().join("study.sqlite3");
        let reads = Arc::new(AtomicUsize::new(0));
        let setup =
            || WorkerSetup::testing(ExtractorSet::new(vec![Arc::new(Heard(reads.clone()))]));
        let correction = Processor::Refiner(RefinerKind::Transcript);
        let source = {
            let app = App::open(&database)?;
            app.switch_processor(SourceKind::Audio, correction, false)?;
            app.start_workers_with(setup())?;
            let path = dir.path().join("lecture.wav");
            std::fs::write(&path, b"RIFF")?;
            let source = app.import_file(&path, None)?.id;
            eventually(|| Ok(extracts(&app, source)? == [JobStatus::Succeeded]))?;
            let document = app.source_document(source)?.expect("read");
            assert!(document.meta.waiting_for.is_empty());

            app.switch_processor(SourceKind::Audio, correction, true)?;
            app.retry_language_model_work()?;
            assert_eq!(
                extracts(&app, source)?.len(),
                1,
                "nothing queued at sign-in"
            );
            source
        };

        let app = App::open(&database)?;
        app.start_workers_with(setup())?;
        app.retry_language_model_work()?;
        assert_eq!(
            extracts(&app, source)?.len(),
            1,
            "nothing queued at the start"
        );
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        Ok(())
    }

    /// The Extract jobs of `source`, oldest last, by status.
    fn extracts(app: &App, source: study_core::SourceId) -> Result<Vec<JobStatus>> {
        Ok(app
            .job_overviews(50)?
            .into_iter()
            .filter(|overview| {
                overview.job.kind == JobKind::Extract
                    && overview.job.target == JobTarget::Source(source)
            })
            .map(|overview| overview.job.status)
            .collect())
    }

    fn corrected(document: &Document) -> bool {
        document
            .meta
            .refiners
            .iter()
            .any(|stamp| stamp.refiner == RefinerKind::Transcript)
    }

    /// A transcript the plan could not correct (it was rate limited) is kept as heard, once:
    /// the read succeeds and is not run again. The next start reads it again when a model is
    /// set up, and only then.
    #[test]
    fn a_transcript_the_plan_could_not_correct_is_kept_and_corrected_at_the_next_start()
    -> Result<()> {
        use study_ai::chat::ModelsConfig;
        use study_ai::testing::{RESPONSES_PATH, answer, signed_in};
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, ResponseTemplate};

        let mock = tokio::runtime::Runtime::new()?;
        let (server, plan) = mock.block_on(signed_in());
        let models = ModelsConfig::from_fn(|_| plan.clone());
        let dir = tempfile::tempdir()?;
        let database = dir.path().join("study.sqlite3");
        let reads = Arc::new(AtomicUsize::new(0));
        let setup =
            || WorkerSetup::testing(ExtractorSet::new(vec![Arc::new(Heard(reads.clone()))]));

        mock.block_on(
            Mock::given(method("POST"))
                .and(path(RESPONSES_PATH))
                .respond_with(ResponseTemplate::new(429))
                .mount(&server),
        );
        let source = {
            let app = App::open(&database)?;
            app.start_workers_with(setup().with_models(models.clone()))?;
            let path = dir.path().join("lecture.wav");
            std::fs::write(&path, b"RIFF")?;
            let source = app.import_file(&path, None)?.id;
            eventually(|| Ok(extracts(&app, source)? == [JobStatus::Succeeded]))?;
            let document = app.source_document(source)?.expect("read");
            assert_eq!(document.text(), "the krebs cycle");
            assert!(!corrected(&document), "{:?}", document.meta.refiners);
            assert_eq!(document.meta.waiting_for, [RefinerKind::Transcript]);
            assert_eq!(reads.load(Ordering::SeqCst), 1, "read once, not retried");
            source
        };

        // Nobody signed in: reading it again would only leave it uncorrected again.
        {
            let app = App::open(&database)?;
            app.start_workers_with(setup())?;
            assert_eq!(extracts(&app, source)?.len(), 1, "nothing queued");
        }

        mock.block_on(server.reset());
        mock.block_on(
            Mock::given(method("POST"))
                .and(path(RESPONSES_PATH))
                .respond_with(answer(r#"{"segments": ["The Krebs cycle."]}"#))
                .mount(&server),
        );
        let app = App::open(&database)?;
        app.start_workers_with(setup().with_models(models))?;
        eventually(|| {
            Ok(app
                .source_document(source)?
                .is_some_and(|document| corrected(&document)))
        })?;
        assert_eq!(
            app.source_document(source)?.expect("read").text(),
            "The Krebs cycle."
        );
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        Ok(())
    }
}
