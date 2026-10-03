//! Language models for Study: providers and model tiers. Agents built on them use
//! [`crate::agent`].
//!
//! Each agent asks [`Models`] for the smallest [`Tier`] that does its job, and the user
//! decides which model serves each tier. Every tier runs on the user's own ChatGPT plan;
//! [`ProviderConfig`] is where another backend would plug in:
//!
//! ```no_run
//! # fn example() -> study_ai::chat::Result<()> {
//! use study_ai::chat::{Connections, LlmPreferences, Models, Tier};
//!
//! // Every tier on the plan's defaults. Nothing is sent until an agent is prompted, and
//! // requests fail as a setup problem until the user signs in.
//! let models = Models::build(LlmPreferences::default().models_config(&Connections::default()))?;
//! let _tiny = models.agent(Tier::Tiny);
//! # Ok(())
//! # }
//! ```
//!
//! Where things live:
//!
//! - `tier.rs`: [`Tier`], tiny, medium, or smart, and [`PerTier`], a value for each.
//! - `models.rs`: [`Models`], a ready model per tier, and the [`ModelsConfig`] behind it.
//! - `preferences.rs`: [`LlmPreferences`], what the user chose for each tier and provider.
//! - `connections.rs`: [`Connections`], the credentials each provider signed in with.
//! - `provider/`: [`ProviderConfig`] and one file of defaults per backend.
//! - `error.rs`: [`Error`], each failure with its kind.

mod connections;
mod error;
mod models;
mod preferences;
pub mod provider;
mod tier;

pub use connections::Connections;
pub use error::{Error, Result};
pub use models::{Models, ModelsConfig};
pub use preferences::{LlmForm, LlmModel, LlmPreferences, LlmProvider, TierSetup};
pub use provider::ProviderConfig;
pub use provider::chatgpt::{ChatGptAccount, ChatGptPreferences};
pub use tier::{PerTier, Tier};
