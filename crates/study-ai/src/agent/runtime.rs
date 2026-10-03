//! [`AgentRuntime`]: what every agent runs with.

use std::sync::Arc;

use study_core::db::{Database, Store};
use study_core::{Context as _, Result};
use study_core::{ErrorKind, Failure, Language, LanguagePreferences};

use super::{AgentSpec, Runner};
use crate::Cached;
use crate::chat::{Connections, LlmPreferences, Models, ModelsConfig, Tier};

/// What every agent needs: the database, and models that follow the saved preferences.
/// Clones share one set of models.
#[derive(Clone)]
pub struct AgentRuntime {
    inner: Arc<Inner>,
}

struct Inner {
    store: Store,
    setup: Setup,
    /// Keyed by the saved preferences and connections, so changing either builds new models.
    models: Cached<Option<(LlmPreferences, Connections)>, Models>,
}

enum Setup {
    Fixed(Box<ModelsConfig>),
    Saved,
}

impl AgentRuntime {
    /// Follows the language model preferences and provider connections saved in `store`, and
    /// saves the account's renewed sign-in there.
    pub fn saved(store: Store) -> Self {
        crate::chat::provider::chatgpt::remember_in(store.clone());
        Self::with(store, Setup::Saved)
    }

    /// Always uses `config`.
    pub fn fixed(store: Store, config: ModelsConfig) -> Self {
        Self::with(store, Setup::Fixed(Box::new(config)))
    }

    fn with(store: Store, setup: Setup) -> Self {
        Self {
            inner: Arc::new(Inner {
                store,
                setup,
                models: Cached::new(),
            }),
        }
    }

    /// Runs blocking database work on a pooled connection.
    pub async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Database) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.inner.store.run(work).await
    }

    /// The models, or `None` when `tier` is not set up (a ChatGPT tier nobody signed in to).
    pub async fn models(&self, tier: Tier) -> Result<Option<Models>> {
        let (key, config) = match &self.inner.setup {
            Setup::Fixed(config) => (None, (**config).clone()),
            Setup::Saved => {
                let (preferences, connections) = self
                    .blocking(|database| {
                        Ok((
                            LlmPreferences::load(database)?,
                            Connections::load(database)?,
                        ))
                    })
                    .await
                    .context("cannot read the language model preferences")?;
                if !preferences.is_ready(tier, &connections) {
                    return Ok(None);
                }
                let config = preferences.models_config(&connections);
                (Some((preferences, connections)), config)
            }
        };
        let models = self
            .inner
            .models
            .get(key, || async {
                Ok::<_, study_core::Error>(Models::build(config)?)
            })
            .await?;
        Ok(Some(models))
    }

    /// Whether any language model tier is set up, read from `database`: whether work that
    /// waited for a model is worth starting now.
    pub fn any_ready(&self, database: &Database) -> Result<bool> {
        match &self.inner.setup {
            Setup::Fixed(_) => Ok(true),
            Setup::Saved => {
                let preferences = LlmPreferences::load(database)?;
                let connections = Connections::load(database)?;
                Ok(Tier::ALL
                    .iter()
                    .any(|tier| preferences.is_ready(*tier, &connections)))
            }
        }
    }

    /// The language the student chose, which agents write in; read again for every run, so
    /// a change in Settings applies to the next piece of work.
    pub async fn language(&self) -> Result<Language> {
        Ok(self
            .blocking(LanguagePreferences::load)
            .await
            .context("cannot read the language")?
            .language)
    }

    /// `S` on its tier's model, or a [`ErrorKind::Config`] failure when that tier is not set
    /// up: for work the user asked for and waits on.
    pub async fn required<S: AgentSpec>(&self) -> Result<Runner<S>, Failure> {
        let models = self.required_models(S::TIER).await?;
        let language = self.language().await?;
        Ok(Runner::new(&models, language))
    }

    /// The models, or a [`ErrorKind::Config`] failure when `tier` is not set up: for work
    /// that runs on a tier's model without an agent of its own, such as reading pages.
    pub async fn required_models(&self, tier: Tier) -> Result<Models, Failure> {
        self.models(tier).await?.ok_or_else(|| unconfigured(tier))
    }
}

/// Why work on `tier` cannot run: it has no model set up.
pub fn unconfigured(tier: Tier) -> Failure {
    Failure::new(
        ErrorKind::Config,
        format!("the {tier:?} model tier is not set up"),
    )
}

#[cfg(test)]
mod tests {
    use study_core::preferences::Secret;

    use super::*;
    use crate::chat::{ChatGptAccount, ChatGptPreferences};

    /// Follows the saved preferences, without making `store` where renewed sign-ins are
    /// saved for the whole process, as [`AgentRuntime::saved`] does.
    fn following(store: &Store) -> AgentRuntime {
        AgentRuntime::with(store.clone(), Setup::Saved)
    }

    fn sign_in(store: &Store, sharing: bool) -> Result<()> {
        store.with(|database| {
            ChatGptPreferences {
                account: Some(ChatGptAccount {
                    client_id: "issued".into(),
                    subject: "user-1".into(),
                    email: None,
                    sharing,
                    refresh_token: Secret::parse("refresh-secret"),
                }),
                ..ChatGptPreferences::default()
            }
            .save(database)
        })
    }

    #[tokio::test]
    async fn a_tier_runs_only_once_the_plan_is_shared_and_follows_new_preferences() -> Result<()> {
        let (_dir, store) = Store::temporary()?;
        let runtime = following(&store);

        assert!(
            runtime.models(Tier::Tiny).await?.is_none(),
            "nobody signed in"
        );
        let failure = runtime.required_models(Tier::Tiny).await.err();
        assert_eq!(failure.map(|failure| failure.kind), Some(ErrorKind::Config));

        sign_in(&store, false)?;
        assert!(
            runtime.models(Tier::Tiny).await?.is_none(),
            "the plan is not shared"
        );

        // Read again on every call: sharing takes effect without a restart.
        sign_in(&store, true)?;
        assert!(runtime.models(Tier::Tiny).await?.is_some());
        assert!(runtime.required_models(Tier::Smart).await.is_ok());
        Ok(())
    }
}
