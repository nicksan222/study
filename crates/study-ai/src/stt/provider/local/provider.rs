//! [`LocalProvider`]: the Parakeet model on this machine, as a pool of loaded copies.

use std::path::PathBuf;

use futures::future::BoxFuture;

use super::parakeet::{self, MAX_CLIP_SECS, Model, NAME, PARAKEET_TDT_V3_INT8};
use crate::stt::error::Result;
use crate::stt::provider::{Clip, Limits, Provider};
use crate::stt::transcript::Transcript;
use crate::{BatchLimits, ModelInstall, ModelPool};

/// Where the local model is, and how many copies of it load.
#[derive(Clone, Debug)]
pub struct LocalConfig {
    /// Directory holding one subdirectory per model. Defaults to the app's model cache.
    pub models_dir: Option<PathBuf>,
    /// Loaded copies of the model. Each can transcribe in parallel and costs about 2 GB of RAM.
    pub instances: usize,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            models_dir: None,
            instances: 1,
        }
    }
}

impl LocalConfig {
    /// The model this config runs, to check, size or install before loading it.
    pub fn model(&self) -> ModelInstall {
        ModelInstall::new(&PARAKEET_TDT_V3_INT8, self.models_dir.clone())
    }
}

/// Runs the model on this machine. Each loaded copy takes one batch at a time.
pub struct LocalProvider {
    models: ModelPool<Model>,
}

impl LocalProvider {
    /// Loads the installed model; fails with a model error when it is not installed. Loading
    /// takes a few seconds.
    pub async fn load(config: LocalConfig) -> Result<Self> {
        let dir = config.model().require()?;
        let models = ModelPool::load(NAME, config.instances, move || parakeet::load(&dir)).await?;
        Ok(Self { models })
    }
}

impl Provider for LocalProvider {
    fn name(&self) -> &'static str {
        NAME
    }

    fn limits(&self) -> Limits {
        Limits {
            max_clip_secs: MAX_CLIP_SECS,
            batch: BatchLimits {
                max_batch_size: 8,
                max_concurrent_batches: self.models.size(),
            },
        }
    }

    fn transcribe_batch(&self, clips: Vec<Clip>) -> BoxFuture<'_, Vec<Result<Transcript>>> {
        Box::pin(self.models.run_batch(clips, parakeet::transcribe))
    }
}
