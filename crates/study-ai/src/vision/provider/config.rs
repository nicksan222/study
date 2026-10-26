//! [`ProviderConfig`]: which backend reads pages, and how it is built.

use std::sync::Arc;

use rig_agent::ModelHandle;
use study_core::Language;

use super::{ModelProvider, Provider};

/// Selects the backend. A new one, such as a model on this computer, is a new variant.
#[derive(Clone)]
pub enum ProviderConfig {
    /// A language model that accepts images, such as a tier of [`crate::chat::Models`],
    /// describing figures in the student's language.
    Model(ModelHandle, Language),
    Custom(Arc<dyn Provider>),
}

impl ProviderConfig {
    /// Builds the provider. Nothing is sent until a page is read.
    pub fn build(self) -> Arc<dyn Provider> {
        match self {
            Self::Model(model, language) => Arc::new(ModelProvider::new(model, language)),
            Self::Custom(provider) => provider,
        }
    }
}

impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Model(model, language) => f
                .debug_tuple("Model")
                .field(&model.label())
                .field(language)
                .finish(),
            Self::Custom(provider) => f.debug_tuple("Custom").field(&provider.name()).finish(),
        }
    }
}
