//! [`Models`]: a ready model per tier, built from a [`ModelsConfig`].

use rig_agent::{AgentBuilder, ModelHandle};

use crate::chat::error::Result;
use crate::chat::provider::ProviderConfig;
use crate::chat::{PerTier, Tier};

/// Which model serves each tier.
pub type ModelsConfig = PerTier<ProviderConfig>;

/// A ready model for every tier. Tiers may use different providers; agents do not care
/// which. Clones share the same models.
#[derive(Clone)]
pub struct Models(PerTier<ModelHandle>);

impl Models {
    /// Sets up every tier's client. Nothing is sent until an agent is prompted.
    pub fn build(config: ModelsConfig) -> Result<Self> {
        config.try_map(ProviderConfig::build).map(Self)
    }

    /// The model serving `tier`.
    pub fn model(&self, tier: Tier) -> ModelHandle {
        self.0.get(tier).clone()
    }

    /// A Rig agent on `tier`'s model, for an agent to add its instructions and tools to.
    pub fn agent(&self, tier: Tier) -> AgentBuilder {
        AgentBuilder::from_model_handle(self.model(tier))
    }
}
