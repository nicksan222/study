//! [`ProviderConfig`]: which backend transcribes, and how it is built.

use std::sync::Arc;

use super::{LocalConfig, LocalProvider, Provider};
use crate::stt::error::Result;

/// Selects the backend. The default is the local model, which needs no account or network
/// after its one-time download. A new backend is a new variant.
#[derive(Clone)]
pub enum ProviderConfig {
    Local(LocalConfig),
    Custom(Arc<dyn Provider>),
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self::Local(LocalConfig::default())
    }
}

impl ProviderConfig {
    /// Builds the provider, loading the local model if needed.
    pub async fn build(self) -> Result<Arc<dyn Provider>> {
        Ok(match self {
            Self::Local(config) => Arc::new(LocalProvider::load(config).await?),
            Self::Custom(provider) => provider,
        })
    }
}

impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local(config) => f.debug_tuple("Local").field(config).finish(),
            Self::Custom(provider) => f.debug_tuple("Custom").field(&provider.name()).finish(),
        }
    }
}
