//! [`ModelPool`]: loaded copies of a local model, each running one batch at a time.

use std::sync::{Arc, Mutex};

use tokio::sync::Semaphore;

use crate::blocking::blocking;
use crate::{Error, Result};

/// Loaded copies of a local model. Each copy works on one batch at a time, on Tokio's
/// blocking pool, so the async runtime never waits on inference.
pub struct ModelPool<M> {
    provider: &'static str,
    /// Idle copies. A batch takes one out and puts it back when done.
    idle: Arc<Mutex<Vec<M>>>,
    available: Semaphore,
    size: usize,
}

impl<M: Send + 'static> ModelPool<M> {
    /// Loads `copies` (at least one) with `load`, off the async runtime.
    pub async fn load<E>(
        provider: &'static str,
        copies: usize,
        load: impl Fn() -> Result<M, E> + Send + 'static,
    ) -> Result<Self, E>
    where
        E: From<Error> + Send + 'static,
    {
        let size = copies.max(1);
        let models = blocking(provider, move || (0..size).map(|_| load()).collect()).await?;
        Ok(Self {
            provider,
            idle: Arc::new(Mutex::new(models)),
            available: Semaphore::new(size),
            size,
        })
    }

    /// How many copies are loaded, and so how many batches can run at once.
    pub fn size(&self) -> usize {
        self.size
    }

    /// Runs `each` over `items` on one idle copy, one result per item in order.
    pub async fn run_batch<I, O, E>(
        &self,
        items: Vec<I>,
        each: fn(&mut M, I) -> Result<O, E>,
    ) -> Vec<Result<O, E>>
    where
        I: Send + 'static,
        O: Send + 'static,
        E: From<Error> + Send + 'static,
    {
        let count = items.len();
        let failed = |error: fn(&'static str) -> Error| -> Vec<Result<O, E>> {
            (0..count)
                .map(|_| Err(error(self.provider).into()))
                .collect()
        };
        let Ok(_permit) = self.available.acquire().await else {
            return failed(|_| Error::Shutdown);
        };
        let idle = Arc::clone(&self.idle);
        let batch = tokio::task::spawn_blocking(move || {
            // Empty only if an earlier batch panicked and took its copy down with it.
            let mut model = idle.lock().expect("model pool lock").pop()?;
            let results = items
                .into_iter()
                .map(|item| each(&mut model, item))
                .collect();
            idle.lock().expect("model pool lock").push(model);
            Some(results)
        })
        .await;
        match batch {
            Ok(Some(results)) => results,
            _ => failed(crashed),
        }
    }
}

fn crashed(provider: &'static str) -> Error {
    Error::Provider {
        provider,
        message: "the model crashed; restart it".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A "model" that counts the items it has seen, and panics on zero.
    fn count(seen: &mut u32, item: u32) -> Result<u32> {
        assert_ne!(item, 0, "the model crashes on zero");
        *seen += 1;
        Ok(item * 10)
    }

    async fn pool(copies: usize) -> ModelPool<u32> {
        ModelPool::load("counter", copies, || Ok::<_, Error>(0))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_batch_runs_on_one_copy_with_results_in_order() {
        let pool = pool(2).await;
        assert_eq!(pool.size(), 2);
        let results = pool.run_batch(vec![3, 1, 2], count).await;
        let results: Vec<u32> = results.into_iter().map(Result::unwrap).collect();
        assert_eq!(results, [30, 10, 20]);
    }

    #[tokio::test]
    async fn at_least_one_copy_is_loaded() {
        assert_eq!(pool(0).await.size(), 1);
    }

    #[tokio::test]
    async fn a_copy_that_crashes_fails_its_batch_and_is_gone() {
        let pool = pool(1).await;
        let crashed = pool.run_batch(vec![1, 0], count).await;
        assert_eq!(crashed.len(), 2);
        assert!(crashed.iter().all(|result| matches!(
            result,
            Err(Error::Provider {
                provider: "counter",
                ..
            })
        )));
        // Its only copy went down with it, so later batches fail too, until it is reloaded.
        let after = pool.run_batch(vec![1], count).await;
        assert!(matches!(after[0], Err(Error::Provider { .. })));
    }
}
