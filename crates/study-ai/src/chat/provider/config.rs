//! [`ProviderConfig`]: which backend serves a tier, and how its model is built.

use rig_agent::completion::Prompt as _;
use rig_agent::{AgentBuilder, ModelHandle};

use super::chatgpt::{self, ChatGptConfig};
use crate::chat::error::Result;

/// One configured model. Requests carry the model name, so building one is cheap and does
/// not touch the network; callers bound their own concurrency. Another provider, such as a
/// model server on this computer, is a new variant here, built by its own module.
#[derive(Clone)]
pub enum ProviderConfig {
    /// The signed-in user's ChatGPT plan.
    ChatGpt(Box<ChatGptConfig>),
    /// A model built elsewhere, such as a test double.
    Custom(ModelHandle),
}

impl ProviderConfig {
    /// The model, ready for agents. Never touches the network.
    pub fn build(self) -> Result<ModelHandle> {
        match self {
            Self::ChatGpt(config) => chatgpt::model(&config),
            Self::Custom(model) => Ok(model),
        }
    }

    /// Sends one short prompt, so a missing sign-in or a wrong model fails in Settings
    /// instead of in a session. Any answer counts, even an empty one: the request was accepted.
    pub async fn check_connection(self) -> Result<()> {
        AgentBuilder::from_model_handle(self.build()?)
            .build()
            .prompt("Reply with OK.")
            .await?;
        Ok(())
    }
}

impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ChatGpt(config) => f.debug_tuple("ChatGpt").field(config).finish(),
            Self::Custom(model) => f.debug_tuple("Custom").field(&model.label()).finish(),
        }
    }
}
