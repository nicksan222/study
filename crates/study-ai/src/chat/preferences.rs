//! What the user chose for language models, stored under the `llm` scope, and how that
//! becomes running [`Models`](crate::chat::Models).

use serde::{Deserialize, Serialize};
use study_core::preferences::{Invalid, Preference};

use crate::ApiConfig;
use crate::chat::provider::ProviderConfig;
use crate::chat::provider::chatgpt::{self, ChatGptConfig};
use crate::chat::{Connections, ModelsConfig, Tier};

study_core::choice! {
    /// Where a language model runs. Only the user's ChatGPT plan today; a new backend is a
    /// new variant, and every `match` on it says what is left to write.
    pub enum LlmProvider {
        /// The user's own ChatGPT plan, once they sign in.
        #[default]
        ChatGpt = "chatgpt",
    }
}

impl LlmProvider {
    /// What this provider uses for `tier` before the user changes anything.
    pub fn defaults(self, tier: Tier) -> ApiConfig {
        match self {
            Self::ChatGpt => chatgpt::defaults(tier),
        }
    }

    /// The model this provider serves `tier` with unless the user picks another.
    pub fn default_model(self, tier: Tier) -> LlmModel {
        match self {
            Self::ChatGpt => chatgpt::default_model(tier),
        }
    }

    /// Whether its models run on this computer, so nothing leaves it.
    pub const fn runs_on_this_computer(self) -> bool {
        match self {
            Self::ChatGpt => false,
        }
    }
}

study_core::choice! {
    /// A language model a provider offers, stored and sent as the id its API takes. A
    /// model the user picks is one of these, never typed in; a new model is a new variant.
    pub enum LlmModel {
        /// The plan's fastest and cheapest, for focused, high-volume work.
        #[default]
        Gpt6Luna = "gpt-6-luna",
        /// Near the most capable, for a fraction of its cost.
        Gpt61Sol = "gpt-6.1-sol",
        /// The plan's most capable.
        Gpt6Astra = "gpt-6-astra",
    }
}

impl LlmModel {
    /// The provider that serves it.
    pub const fn provider(self) -> LlmProvider {
        match self {
            Self::Gpt6Luna | Self::Gpt61Sol | Self::Gpt6Astra => LlmProvider::ChatGpt,
        }
    }

    /// The models `provider` offers, in [`Self::ALL`] order.
    pub fn of(provider: LlmProvider) -> impl Iterator<Item = LlmModel> {
        Self::ALL
            .iter()
            .copied()
            .filter(move |model| model.provider() == provider)
    }
}

/// Which provider serves one tier, and with which model.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct TierSetup {
    pub provider: LlmProvider,
    /// `None` keeps the provider's default for the tier. A model of another provider is
    /// ignored, as if unset.
    pub model: Option<LlmModel>,
}

impl TierSetup {
    /// The model the tier runs on: the one picked, when its provider serves the tier,
    /// else the provider's default.
    pub fn model(&self, tier: Tier) -> LlmModel {
        self.model
            .filter(|model| model.provider() == self.provider)
            .unwrap_or_else(|| self.provider.default_model(tier))
    }
}

impl Preference for TierSetup {
    type Form = Self;

    fn to_form(&self) -> Self {
        *self
    }

    fn from_form(form: &Self) -> Result<Self, Invalid> {
        Ok(*form)
    }
}

study_core::preferences! {
    /// Which model serves each tier. Provider credentials are kept apart, each in its own
    /// scope, and reach these settings as [`Connections`].
    #[preferences(scope = "llm", form = LlmForm)]
    pub struct LlmPreferences {
        pub tiny: TierSetup = TierSetup::default(),
        pub medium: TierSetup = TierSetup::default(),
        pub smart: TierSetup = TierSetup::default(),
    }
}

impl LlmPreferences {
    /// What the user set for `tier`.
    pub fn tier(&self, tier: Tier) -> &TierSetup {
        tier.pick(&self.tiny, &self.medium, &self.smart)
    }

    /// The first tier that lacks what it needs, given the providers' `connections`, and
    /// the provider it is set to; `None` when every tier is ready.
    pub fn first_unready(&self, connections: &Connections) -> Option<(Tier, LlmProvider)> {
        Tier::ALL
            .into_iter()
            .find(|&tier| !self.is_ready(tier, connections))
            .map(|tier| (tier, self.tier(tier).provider))
    }

    /// Whether `tier` has what it needs to start: its provider is connected.
    pub fn is_ready(&self, tier: Tier, connections: &Connections) -> bool {
        connections.is_connected(self.tier(tier).provider)
    }

    /// The model `tier` runs on. Anything left unset keeps the provider default.
    pub fn provider_config(&self, tier: Tier, connections: &Connections) -> ProviderConfig {
        let setup = self.tier(tier);
        let mut api = setup.provider.defaults(tier);
        api.model = setup.model(tier).code().to_owned();
        match setup.provider {
            LlmProvider::ChatGpt => ProviderConfig::ChatGpt(Box::new(ChatGptConfig {
                api,
                issuer: chatgpt::ISSUER.into(),
                account: connections.chatgpt.clone(),
            })),
        }
    }

    /// Every tier's [`provider_config`](Self::provider_config).
    pub fn models_config(&self, connections: &Connections) -> ModelsConfig {
        ModelsConfig::from_fn(|tier| self.provider_config(tier, connections))
    }
}

impl LlmForm {
    /// The form's setup for `tier`.
    pub fn tier(&self, tier: Tier) -> &TierSetup {
        tier.pick(&self.tiny, &self.medium, &self.smart)
    }

    /// The form's setup for `tier`, to edit.
    pub fn tier_mut(&mut self, tier: Tier) -> &mut TierSetup {
        tier.pick(&mut self.tiny, &mut self.medium, &mut self.smart)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::ChatGptAccount;
    use study_core::db::Database;
    use study_core::preferences::Secret;

    fn account(sharing: bool) -> ChatGptAccount {
        ChatGptAccount {
            client_id: "issued".into(),
            subject: "user-1".into(),
            email: None,
            sharing,
            refresh_token: Secret::parse("refresh-secret"),
        }
    }

    fn signed_in(sharing: bool) -> Connections {
        Connections {
            chatgpt: Some(account(sharing)),
        }
    }

    fn everywhere(provider: LlmProvider) -> LlmPreferences {
        let setup = TierSetup {
            provider,
            model: None,
        };
        LlmPreferences {
            tiny: setup,
            medium: setup,
            smart: setup,
        }
    }

    #[test]
    fn a_fresh_database_runs_every_tier_on_the_plan_once_signed_in() -> study_core::Result<()> {
        let (_dir, database) = Database::temporary()?;
        let preferences = LlmPreferences::load(&database)?;
        assert_eq!(preferences, LlmPreferences::default());
        for tier in Tier::ALL {
            assert!(
                !preferences.is_ready(tier, &Connections::default()),
                "nobody signed in"
            );
            let ProviderConfig::ChatGpt(config) =
                preferences.provider_config(tier, &Connections::default())
            else {
                unreachable!("preferences only build the plan's models");
            };
            assert_eq!(config.api.model, chatgpt::defaults(tier).model);
        }
        Ok(())
    }

    #[test]
    fn a_chatgpt_tier_is_ready_only_once_the_plan_is_shared() {
        let preferences = LlmPreferences {
            smart: TierSetup {
                provider: LlmProvider::ChatGpt,
                model: Some(LlmModel::Gpt61Sol),
            },
            ..LlmPreferences::default()
        };
        assert!(
            !preferences.is_ready(Tier::Smart, &Connections::default()),
            "nobody signed in"
        );
        assert!(!preferences.is_ready(Tier::Smart, &signed_in(false)));
        assert!(preferences.is_ready(Tier::Smart, &signed_in(true)));

        let ProviderConfig::ChatGpt(config) =
            preferences.provider_config(Tier::Smart, &signed_in(true))
        else {
            unreachable!("preferences only build the plan's models");
        };
        assert_eq!(config.api.model, "gpt-6.1-sol");
        assert_eq!(config.api.base_url, chatgpt::API_BASE);
        assert_eq!(config.issuer, chatgpt::ISSUER);
        assert_eq!(config.account, Some(account(true)));
        assert!(!format!("{config:?}").contains("refresh-secret"));
    }

    /// The API settings a tier's model is built from. Exhaustive, so a new [`ProviderConfig`]
    /// variant must be added here, and the test below then covers it.
    fn api_of(config: &ProviderConfig) -> &ApiConfig {
        match config {
            ProviderConfig::ChatGpt(config) => &config.api,
            ProviderConfig::Custom(_) => panic!("preferences never build a custom model"),
        }
    }

    #[test]
    fn every_provider_serves_every_tier_from_its_own_defaults() {
        for &provider in LlmProvider::ALL {
            let preferences = everywhere(provider);
            for tier in Tier::ALL {
                assert!(preferences.is_ready(tier, &signed_in(true)), "{provider:?}");
                let defaults = provider.defaults(tier);
                assert!(!defaults.base_url.is_empty() && !defaults.model.is_empty());

                let config = preferences.provider_config(tier, &signed_in(true));
                let api = api_of(&config);
                assert_eq!(api.base_url, defaults.base_url, "{provider:?} {tier:?}");
                assert_eq!(api.model, defaults.model, "{provider:?} {tier:?}");
                assert!(
                    config.build().is_ok(),
                    "{provider:?} {tier:?} builds offline"
                );
            }
        }
    }

    #[test]
    fn a_tier_runs_on_the_model_picked_or_its_default() {
        let picked = TierSetup {
            provider: LlmProvider::ChatGpt,
            model: Some(LlmModel::Gpt6Astra),
        };
        assert_eq!(picked.model(Tier::Tiny), LlmModel::Gpt6Astra);
        let default = TierSetup::default();
        assert_eq!(default.model(Tier::Medium), LlmModel::Gpt61Sol);
        assert_eq!(
            LlmModel::of(LlmProvider::ChatGpt).count(),
            LlmModel::ALL.len()
        );
        let preferences = LlmPreferences {
            smart: picked,
            ..LlmPreferences::default()
        };
        assert_eq!(LlmForm::from(&preferences).parse().unwrap(), preferences);
    }
}
