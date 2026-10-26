//! Adaptive request batching in front of a provider.
//!
//! Items from every caller share one bounded queue. A batch is dispatched once a provider
//! slot is free and either the batch is full or a short gathering window has passed. While
//! all slots are busy the batch keeps growing, so throughput rises under load without adding
//! latency to a lone request. Identical items in a batch are processed once, and items whose
//! caller has gone away are dropped before any work is done.

use std::collections::HashMap;
use std::fmt::Display;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Duration;

use futures::future::BoxFuture;
use sha2::{Digest, Sha256};
use study_core::Classify;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot};

use crate::Error;

/// The work behind a [`Batcher`]: usually a thin wrapper around a feature's provider.
pub trait BatchWork: Send + Sync + 'static {
    type Item: Send + 'static;
    type Output: Clone + Send + 'static;
    type Error: From<Error> + Classify + Display + Send + 'static;

    /// The provider's name, for the failures the batcher reports for it.
    fn name(&self) -> &'static str;

    /// What the provider can take at once.
    fn limits(&self) -> BatchLimits;

    /// Processes every item, returning one result per item in the same order.
    fn run(&self, items: Vec<Self::Item>) -> BoxFuture<'_, Vec<Result<Self::Output, Self::Error>>>;

    /// `error` again, for another caller that sent the identical item. Errors hold
    /// non-cloneable sources, so by default the copy keeps only the text and the kind; work
    /// whose callers look closer at its errors returns a copy they read the same way.
    fn share(&self, error: &Self::Error) -> Self::Error {
        shared(error).into()
    }
}

/// `error` as another caller's failure: its text, its kind and when to retry.
pub(crate) fn shared(error: &(impl Classify + Display)) -> Error {
    Error::Shared {
        message: error.to_string(),
        kind: error.kind(),
        retry_after: error.retry_after(),
    }
}

/// What a provider can take at once.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BatchLimits {
    /// Most items handed over in one `BatchWork::run` call.
    pub max_batch_size: usize,
    /// Most batches in flight at once.
    pub max_concurrent_batches: usize,
}

/// How a `Batcher` gathers items into batches.
#[derive(Clone, Debug)]
pub struct BatchingConfig {
    /// How long the first item of a batch waits for companions when a provider slot is free.
    pub max_wait: Duration,
    /// Items that may wait in the queue before callers are made to wait.
    pub queue_capacity: NonZeroUsize,
    /// Lowers the provider's own batch size limit, never raises it.
    pub max_batch_size: Option<NonZeroUsize>,
}

impl Default for BatchingConfig {
    fn default() -> Self {
        Self {
            max_wait: Duration::from_millis(15),
            queue_capacity: NonZeroUsize::new(256).expect("nonzero"),
            max_batch_size: None,
        }
    }
}

/// Identifies identical items, so a batch processes each only once.
pub type Key = [u8; 32];

/// Builds a [`Key`] from everything that makes an item what it is.
#[derive(Default)]
pub struct KeyHasher(Sha256);

impl KeyHasher {
    /// Adds `bytes` to what the key is made of.
    pub fn update(&mut self, bytes: impl AsRef<[u8]>) -> &mut Self {
        self.0.update(bytes);
        self
    }

    /// The key of everything added.
    pub fn finish(self) -> Key {
        self.0.finalize().into()
    }
}

type Reply<W> = oneshot::Sender<Result<<W as BatchWork>::Output, <W as BatchWork>::Error>>;

struct Job<W: BatchWork> {
    item: W::Item,
    key: Key,
    reply: Reply<W>,
}

/// The shared queue in front of one [`BatchWork`]; every caller submits through it.
pub struct Batcher<W: BatchWork> {
    jobs: mpsc::Sender<Job<W>>,
}

impl<W: BatchWork> Batcher<W> {
    /// Starts the batching task on the current Tokio runtime. It stops when the batcher drops.
    pub fn spawn(work: Arc<W>, config: BatchingConfig) -> Self {
        let (jobs, queue) = mpsc::channel(config.queue_capacity.get());
        tokio::spawn(run(queue, work, config));
        Self { jobs }
    }

    /// Queues `item` and waits for its result. Items with the same `key` in one batch are
    /// processed once.
    pub async fn submit(&self, item: W::Item, key: Key) -> Result<W::Output, W::Error> {
        let (reply, response) = oneshot::channel();
        self.jobs
            .send(Job { item, key, reply })
            .await
            .map_err(|_| Error::Shutdown)?;
        response.await.map_err(|_| Error::Shutdown)?
    }
}

async fn run<W: BatchWork>(
    mut queue: mpsc::Receiver<Job<W>>,
    work: Arc<W>,
    config: BatchingConfig,
) {
    let limits = work.limits();
    let max_batch = config
        .max_batch_size
        .map_or(usize::MAX, NonZeroUsize::get)
        .min(limits.max_batch_size)
        .max(1);
    let slots = Arc::new(Semaphore::new(limits.max_concurrent_batches.max(1)));

    while let Some(first) = queue.recv().await {
        let (batch, slot) = gather(&mut queue, first, max_batch, &slots, config.max_wait).await;
        let work = Arc::clone(&work);
        tokio::spawn(async move {
            let _slot = slot;
            dispatch(work.as_ref(), batch).await;
        });
    }
}

/// The batch that starts with `first`, and the provider slot it runs in. It is ready once a
/// slot is free and it is full, `max_wait` has passed, or the queue has closed; until a slot
/// frees up it keeps growing.
async fn gather<W: BatchWork>(
    queue: &mut mpsc::Receiver<Job<W>>,
    first: Job<W>,
    max_batch: usize,
    slots: &Arc<Semaphore>,
    max_wait: Duration,
) -> (Vec<Job<W>>, OwnedSemaphorePermit) {
    let mut batch = vec![first];
    let mut open = true;
    let window = tokio::time::sleep(max_wait);
    tokio::pin!(window);
    let mut window_elapsed = false;
    let acquire = Arc::clone(slots).acquire_owned();
    tokio::pin!(acquire);
    let mut slot = None;

    loop {
        let full = batch.len() >= max_batch;
        if (full || window_elapsed || !open)
            && let Some(slot) = slot
        {
            return (batch, slot);
        }
        tokio::select! {
            biased;
            permit = &mut acquire, if slot.is_none() => {
                slot = Some(permit.expect("the semaphore is never closed"));
            }
            job = queue.recv(), if open && !full => match job {
                Some(job) => batch.push(job),
                None => open = false,
            },
            () = &mut window, if !window_elapsed => window_elapsed = true,
        }
    }
}

async fn dispatch<W: BatchWork>(work: &W, batch: Vec<Job<W>>) {
    let mut items = Vec::new();
    let mut waiters: Vec<Vec<Reply<W>>> = Vec::new();
    let mut index_of_key: HashMap<Key, usize> = HashMap::new();
    for job in batch {
        if job.reply.is_closed() {
            continue;
        }
        match index_of_key.get(&job.key) {
            Some(&index) => waiters[index].push(job.reply),
            None => {
                index_of_key.insert(job.key, items.len());
                items.push(job.item);
                waiters.push(vec![job.reply]);
            }
        }
    }
    if items.is_empty() {
        return;
    }

    let expected = items.len();
    let mut results = work.run(items).await;
    if results.len() != expected {
        let message = format!("returned {} results for {expected} items", results.len());
        results = (0..expected)
            .map(|_| {
                Err(Error::Provider {
                    provider: work.name(),
                    message: message.clone(),
                }
                .into())
            })
            .collect();
    }
    for (result, replies) in results.into_iter().zip(waiters) {
        let mut replies = replies.into_iter();
        let first = replies.next().expect("every entry has a waiter");
        for reply in replies {
            let copy = match &result {
                Ok(output) => Ok(output.clone()),
                Err(error) => Err(work.share(error)),
            };
            let _ = reply.send(copy);
        }
        let _ = first.send(result);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use futures::future::join_all;
    use tokio::sync::Semaphore as Gate;

    use super::*;

    /// Answers each number with its text and records every batch it receives.
    struct Recorder {
        limits: BatchLimits,
        batches: Mutex<Vec<Vec<u32>>>,
        /// Each batch takes one permit before answering, letting tests hold the provider busy.
        gate: Gate,
        fail: Option<u32>,
    }

    impl Recorder {
        fn new(max_batch_size: usize) -> Self {
            Self {
                limits: BatchLimits {
                    max_batch_size,
                    max_concurrent_batches: 1,
                },
                batches: Mutex::default(),
                gate: Gate::new(Gate::MAX_PERMITS),
                fail: None,
            }
        }

        fn held(self) -> Self {
            Self {
                gate: Gate::new(0),
                ..self
            }
        }

        fn batches(&self) -> Vec<Vec<u32>> {
            self.batches.lock().unwrap().clone()
        }
    }

    impl BatchWork for Recorder {
        type Item = u32;
        type Output = String;
        type Error = Error;

        fn name(&self) -> &'static str {
            "recorder"
        }

        fn limits(&self) -> BatchLimits {
            self.limits
        }

        fn run(&self, items: Vec<u32>) -> BoxFuture<'_, Vec<Result<String, Error>>> {
            Box::pin(async move {
                self.batches.lock().unwrap().push(items.clone());
                self.gate.acquire().await.unwrap().forget();
                items
                    .into_iter()
                    .map(|n| match self.fail {
                        // Signed out: a setting to fix, not a bug.
                        Some(fail) if fail == n => Err(Error::Io(std::io::Error::new(
                            std::io::ErrorKind::PermissionDenied,
                            "boom",
                        ))),
                        _ => Ok(format!("item {n}")),
                    })
                    .collect()
            })
        }
    }

    fn key(n: u32) -> Key {
        let mut hasher = KeyHasher::default();
        hasher.update(n.to_le_bytes());
        hasher.finish()
    }

    async fn submit(batcher: &Batcher<Recorder>, n: u32) -> Result<String, Error> {
        batcher.submit(n, key(n)).await
    }

    fn start(recorder: Recorder) -> (Arc<Recorder>, Arc<Batcher<Recorder>>) {
        let recorder = Arc::new(recorder);
        let batcher = Batcher::spawn(Arc::clone(&recorder), BatchingConfig::default());
        (recorder, Arc::new(batcher))
    }

    #[tokio::test]
    async fn concurrent_requests_are_coalesced_within_provider_limits() {
        let (recorder, batcher) = start(Recorder::new(4));

        let results = join_all((1..=20).map(|n| submit(&batcher, n))).await;

        for (n, result) in (1..=20).zip(results) {
            assert_eq!(result.unwrap(), format!("item {n}"));
        }
        let batches = recorder.batches();
        assert!(batches.iter().all(|b| b.len() <= 4), "{batches:?}");
        assert_eq!(batches.iter().map(Vec::len).sum::<usize>(), 20);
        assert!(batches.len() < 20, "requests were batched: {batches:?}");
    }

    #[tokio::test]
    async fn batches_grow_while_the_provider_is_busy() {
        let (recorder, batcher) = start(Recorder::new(8).held());

        let first = tokio::spawn({
            let batcher = Arc::clone(&batcher);
            async move { submit(&batcher, 1).await }
        });
        // Past the gathering window: the first batch is dispatched and holds the only slot.
        tokio::time::sleep(Duration::from_millis(50)).await;
        let rest = join_all((2..=7).map(|n| submit(&batcher, n)));
        let release = async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            recorder.gate.add_permits(2);
        };
        let (rest, ()) = tokio::join!(rest, release);

        assert!(first.await.unwrap().is_ok() && rest.iter().all(Result::is_ok));
        assert_eq!(recorder.batches(), vec![vec![1], vec![2, 3, 4, 5, 6, 7]]);
    }

    #[tokio::test]
    async fn identical_items_are_processed_once() {
        let (recorder, batcher) = start(Recorder::new(8));

        let results = join_all((0..5).map(|_| submit(&batcher, 42))).await;

        assert!(results.iter().all(|r| r.as_ref().unwrap() == "item 42"));
        assert_eq!(recorder.batches().iter().map(Vec::len).sum::<usize>(), 1);
    }

    #[tokio::test]
    async fn abandoned_requests_are_skipped() {
        let (recorder, batcher) = start(Recorder::new(8).held());
        let spawn = |n| {
            let batcher = Arc::clone(&batcher);
            tokio::spawn(async move { submit(&batcher, n).await })
        };

        let first = spawn(1);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let abandoned = spawn(2);
        tokio::time::sleep(Duration::from_millis(50)).await;
        abandoned.abort();
        let kept = spawn(3);
        tokio::time::sleep(Duration::from_millis(50)).await;
        recorder.gate.add_permits(2);

        assert!(first.await.unwrap().is_ok());
        assert!(kept.await.unwrap().is_ok());
        assert_eq!(recorder.batches(), vec![vec![1], vec![3]]);
    }

    #[tokio::test]
    async fn one_failing_item_does_not_fail_its_batch() {
        let (_, batcher) = start(Recorder {
            fail: Some(2),
            ..Recorder::new(8)
        });

        let results = join_all((1..=3).map(|n| submit(&batcher, n))).await;

        assert!(results[0].is_ok());
        assert!(matches!(results[1], Err(Error::Io(_))));
        assert!(results[2].is_ok());
    }

    #[tokio::test]
    async fn a_failure_reaches_every_caller_of_an_identical_item() {
        let (recorder, batcher) = start(Recorder {
            fail: Some(7),
            ..Recorder::new(8)
        });

        let results = join_all((0..3).map(|_| submit(&batcher, 7))).await;

        assert_eq!(recorder.batches(), vec![vec![7]]);
        // The first caller gets the error itself; the others get its text and kind.
        assert_eq!(
            results
                .iter()
                .filter(|r| matches!(r, Err(Error::Io(_))))
                .count(),
            1
        );
        for result in &results {
            let error = result.as_ref().unwrap_err();
            assert!(error.to_string().contains("boom"), "{error}");
            assert_eq!(error.kind(), study_core::ErrorKind::Config, "{error}");
        }
    }

    /// Answers every batch with one result too few.
    struct ShortChanged;

    impl BatchWork for ShortChanged {
        type Item = u32;
        type Output = String;
        type Error = Error;

        fn name(&self) -> &'static str {
            "short"
        }

        fn limits(&self) -> BatchLimits {
            BatchLimits {
                max_batch_size: 8,
                max_concurrent_batches: 1,
            }
        }

        fn run(&self, items: Vec<u32>) -> BoxFuture<'_, Vec<Result<String, Error>>> {
            Box::pin(async move { items.iter().skip(1).map(|n| Ok(n.to_string())).collect() })
        }
    }

    #[tokio::test]
    async fn a_provider_that_miscounts_its_results_fails_the_whole_batch() {
        let batcher = Batcher::spawn(Arc::new(ShortChanged), BatchingConfig::default());

        let results = join_all((1..=3).map(|n| batcher.submit(n, key(n)))).await;

        for result in results {
            assert!(
                matches!(
                    &result,
                    Err(Error::Provider {
                        provider: "short",
                        ..
                    })
                ),
                "{result:?}"
            );
        }
    }

    #[tokio::test]
    async fn configured_batch_size_can_only_lower_the_provider_limit() {
        let recorder = Arc::new(Recorder::new(8));
        let config = BatchingConfig {
            max_batch_size: NonZeroUsize::new(2),
            ..BatchingConfig::default()
        };
        let batcher = Batcher::spawn(Arc::clone(&recorder), config);

        join_all((1..=6).map(|n| batcher.submit(n, key(n)))).await;

        assert!(recorder.batches().iter().all(|b| b.len() <= 2));
    }
}
