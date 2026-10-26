//! [`EmbedderConfig`]: which embedder search uses, and how it is found and loaded.

use std::path::PathBuf;
use std::sync::Arc;

use study_core::Result;

use super::{Embedder, MULTILINGUAL_E5_SMALL, OnnxEmbedder};
use crate::ModelInstall;

/// Selects the embedder. The default is the local model; another embedder is one more
/// variant, and the compiler lists the arms left to write.
#[derive(Clone, Debug)]
pub enum EmbedderConfig {
    Local(LocalConfig),
}

impl Default for EmbedderConfig {
    fn default() -> Self {
        Self::Local(LocalConfig::default())
    }
}

impl EmbedderConfig {
    /// Whether the embedder can load without downloading anything.
    pub fn is_installed(&self) -> bool {
        match self {
            Self::Local(config) => config.model().is_installed(),
        }
    }

    /// Loads the embedder. Fails, without downloading anything, when it is not installed.
    /// Takes a moment; call from a blocking context.
    pub fn load(&self) -> Result<Arc<dyn Embedder>> {
        match self {
            Self::Local(config) => Ok(Arc::new(OnnxEmbedder::load(&config.model().require()?)?)),
        }
    }
}

/// [`MULTILINGUAL_E5_SMALL`] on this computer.
#[derive(Clone, Debug, Default)]
pub struct LocalConfig {
    /// Directory holding one subdirectory per model. Defaults to the app's model cache.
    pub models_dir: Option<PathBuf>,
}

impl LocalConfig {
    /// The model this config runs, to check, size or install before loading it.
    pub fn model(&self) -> ModelInstall {
        ModelInstall::new(&MULTILINGUAL_E5_SMALL, self.models_dir.clone())
    }
}
