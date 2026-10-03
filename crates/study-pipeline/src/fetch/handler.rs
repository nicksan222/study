//! Runs the fetchers as the `Fetch` job of a link source: brings in what its address holds,
//! stores it in place of the link (keeping the source's id), and queues its read when its
//! plan reads it. A failed fetch goes back to the jobs engine as it is, to retry.

use study_core::db::{Job, JobTarget, NewJob, Store};
use study_core::jobs::{JobHandler, Lane, wrong_target};
use study_core::processing::{BoxFuture, plan_for};
use study_core::{Failure, JobKind, SourceId, SourceKind};

use super::FetcherSet;
use crate::ExtractorSet;

/// Brings link sources in with the fetchers, then hands them to the extractors.
pub struct FetchHandler {
    store: Store,
    fetchers: FetcherSet,
    extractors: ExtractorSet,
}

impl FetchHandler {
    /// Fetches with `fetchers` into `store`, and queues the read when `extractors` can read
    /// what was brought in.
    pub fn new(store: Store, fetchers: FetcherSet, extractors: ExtractorSet) -> Self {
        Self {
            store,
            fetchers,
            extractors,
        }
    }

    /// Brings in link `id`, unless it is gone, and returns its read when it has one.
    async fn bring_in(&self, id: SourceId) -> Result<Vec<NewJob>, Failure> {
        let Some(source) = self.store.run(move |database| database.source(id)).await? else {
            return Ok(Vec::new());
        };
        // A run interrupted after storing the fetch left only the read to queue.
        if source.kind == SourceKind::Link {
            // A link's name is its address too.
            let url = source.uri.unwrap_or(source.name);
            let fetched = self.fetchers.fetch(&url).await?;
            let stored = self
                .store
                .run(move |database| database.store_fetched(id, &fetched))
                .await?;
            if stored.is_none() {
                return Ok(Vec::new());
            }
        }
        let target = JobTarget::Source(id);
        let plan = self
            .store
            .run(move |database| plan_for(database, target))
            .await?;
        let readable = plan.is_some_and(|plan| self.extractors.can_read(&plan));
        Ok(if readable {
            vec![NewJob::new(JobKind::Extract, target)]
        } else {
            Vec::new()
        })
    }
}

impl JobHandler for FetchHandler {
    fn kind(&self) -> JobKind {
        JobKind::Fetch
    }

    fn lane(&self) -> Lane {
        Lane::Reading
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(source) = job.target.source() else {
                return Err(wrong_target(&job));
            };
            self.bring_in(source).await
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use study_core::processing::{Fetched, Fetcher, FetcherKind};
    use study_core::{ErrorKind, mime};

    use super::*;

    const PAGE: &[u8] = b"<html><body><p>Cells</p></body></html>";

    /// Brings in a page from any address, or fails as told, and counts its calls.
    struct Fake {
        fails: Option<ErrorKind>,
        calls: AtomicUsize,
    }

    impl Fetcher for Fake {
        fn kind(&self) -> FetcherKind {
            FetcherKind::Page
        }

        fn accepts(&self, _: &str) -> bool {
            true
        }

        fn fetch<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<Fetched, Failure>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                if let Some(kind) = self.fails {
                    return Err(Failure::new(kind, "the fake failed"));
                }
                Ok(Fetched {
                    name: "Cells".into(),
                    bytes: PAGE.to_vec(),
                    kind: SourceKind::Web,
                    mime: mime::HTML.into(),
                    uri: url.into(),
                })
            })
        }
    }

    /// A link added to a fresh store, its Fetch job, and a handler fetching with a fake and
    /// reading with `extractors`.
    fn link(
        fails: Option<ErrorKind>,
        extractors: ExtractorSet,
    ) -> (tempfile::TempDir, Store, Job, Arc<Fake>, FetchHandler) {
        let (dir, store) = Store::temporary().unwrap();
        let job = store
            .with(|database| {
                let (_, job) = database.add_link(None, "https://example.org/cells")?;
                Ok(database.job(job)?.unwrap())
            })
            .unwrap();
        let fake = Arc::new(Fake {
            fails,
            calls: AtomicUsize::new(0),
        });
        let fetchers = FetcherSet::new(vec![fake.clone() as Arc<dyn Fetcher>]);
        let handler = FetchHandler::new(store.clone(), fetchers, extractors);
        (dir, store, job, fake, handler)
    }

    fn source(store: &Store, job: &Job) -> Option<study_core::db::Source> {
        let id = job.target.source().unwrap();
        store.with(|database| database.source(id)).unwrap()
    }

    fn extract(job: &Job) -> Vec<(JobKind, JobTarget)> {
        vec![(JobKind::Extract, job.target)]
    }

    fn queued(jobs: &[NewJob]) -> Vec<(JobKind, JobTarget)> {
        jobs.iter().map(|job| (job.kind, job.target)).collect()
    }

    #[tokio::test]
    async fn a_fetched_link_is_stored_in_its_place_and_read() {
        let (_dir, store, job, _fake, handler) = link(None, ExtractorSet::shipped());
        let next = handler.run(job.clone()).await.unwrap();
        assert_eq!(queued(&next), extract(&job));
        let source = source(&store, &job).unwrap();
        assert_eq!(
            (source.kind, source.name.as_str()),
            (SourceKind::Web, "Cells")
        );
        let bytes = store
            .with(|database| database.read_source_bounded(source.id, 1024))
            .unwrap();
        assert_eq!(bytes.as_deref(), Some(PAGE));
    }

    #[tokio::test]
    async fn a_fetched_link_nothing_can_read_is_stored_but_not_read() {
        let (_dir, store, job, _fake, handler) = link(None, ExtractorSet::default());
        assert!(handler.run(job.clone()).await.unwrap().is_empty());
        assert_eq!(source(&store, &job).unwrap().kind, SourceKind::Web);
    }

    #[tokio::test]
    async fn a_link_already_brought_in_is_not_fetched_again() {
        let (_dir, _store, job, fake, handler) = link(None, ExtractorSet::shipped());
        handler.run(job.clone()).await.unwrap();
        let next = handler.run(job.clone()).await.unwrap();
        assert_eq!(queued(&next), extract(&job));
        assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_failed_fetch_returns_its_failure_and_leaves_the_link() {
        let (_dir, store, job, _fake, handler) =
            link(Some(ErrorKind::Transient), ExtractorSet::shipped());
        let failure = handler.run(job.clone()).await.unwrap_err();
        assert_eq!(failure.kind, ErrorKind::Transient);
        assert_eq!(source(&store, &job).unwrap().kind, SourceKind::Link);
    }

    #[tokio::test]
    async fn a_gone_link_is_nothing_to_do() {
        let (_dir, store, job, fake, handler) = link(None, ExtractorSet::shipped());
        let id = job.target.source().unwrap();
        store.with(|database| database.delete_source(id)).unwrap();
        assert!(handler.run(job).await.unwrap().is_empty());
        assert_eq!(fake.calls.load(Ordering::SeqCst), 0);
    }
}
