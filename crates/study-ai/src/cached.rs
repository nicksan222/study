//! [`Cached`]: one running engine, kept while the setup it started with holds.

use std::future::Future;

use tokio::sync::Mutex;

/// Keeps one running engine (a transcriber, the language models) and the setup it started with, so
/// jobs share it until the setup changes. Engines start on first use, so opening the app
/// never downloads or loads a model, and a failed start is retried by the next job.
pub struct Cached<S, E> {
    current: Mutex<Option<(S, E)>>,
}

impl<S: PartialEq, E: Clone> Default for Cached<S, E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<S: PartialEq, E: Clone> Cached<S, E> {
    /// Nothing running yet: the first [`get`](Self::get) starts the engine.
    pub fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    /// The engine for `setup`, starting a new one with `start` if the setup changed.
    pub async fn get<F, Error>(&self, setup: S, start: impl FnOnce() -> F) -> Result<E, Error>
    where
        F: Future<Output = Result<E, Error>>,
    {
        // Held across the start so concurrent jobs share one model download.
        let mut current = self.current.lock().await;
        if let Some((running, engine)) = current.as_ref()
            && *running == setup
        {
            return Ok(engine.clone());
        }
        let engine = start().await?;
        *current = Some((setup, engine.clone()));
        Ok(engine)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// Counts its starts; each engine is the number of its start.
    #[derive(Default)]
    struct Starts(AtomicUsize);

    impl Starts {
        async fn start(&self) -> Result<usize, ()> {
            let number = self.0.fetch_add(1, Ordering::SeqCst) + 1;
            // Lets a concurrent use run while this start is under way.
            tokio::task::yield_now().await;
            Ok(number)
        }

        fn count(&self) -> usize {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[tokio::test]
    async fn concurrent_first_uses_start_one_engine() {
        let cached = Cached::new();
        let starts = Starts::default();
        let (first, second) = tokio::join!(
            cached.get("setup", || starts.start()),
            cached.get("setup", || starts.start()),
        );
        assert_eq!((first, second), (Ok(1), Ok(1)));
        assert_eq!(starts.count(), 1);
    }

    #[tokio::test]
    async fn a_changed_setup_starts_a_new_engine() {
        let cached = Cached::new();
        let starts = Starts::default();
        assert_eq!(cached.get("a", || starts.start()).await, Ok(1));
        assert_eq!(cached.get("a", || starts.start()).await, Ok(1));
        assert_eq!(cached.get("b", || starts.start()).await, Ok(2));
        assert_eq!(starts.count(), 2);
    }

    #[tokio::test]
    async fn a_failed_start_is_tried_again_on_the_next_use() {
        let cached = Cached::new();
        let starts = Starts::default();
        let failed = cached.get("setup", || async { Err::<usize, ()>(()) }).await;
        assert_eq!(failed, Err(()));
        assert_eq!(cached.get("setup", || starts.start()).await, Ok(1));
        assert_eq!(starts.count(), 1);
    }
}
