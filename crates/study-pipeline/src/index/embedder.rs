//! The local search model, loaded once it is installed and shared by indexing and searching.

use std::sync::{Arc, Mutex};

use study_ai::embed::{Embedder, EmbedderConfig, Role};
use study_core::Result;

/// Where the loaded model lives. Empty until the model is installed; loading never
/// downloads.
#[derive(Clone, Default)]
pub struct EmbedderSlot {
    config: EmbedderConfig,
    state: Arc<Mutex<State>>,
}

#[derive(Default)]
enum State {
    /// Loaded the first time it is asked for, once installed.
    #[default]
    Unloaded,
    Loaded(Arc<dyn Embedder>),
    /// Installed but did not load: not tried again until it is installed again
    /// ([`EmbedderSlot::installed`]), so search matches words only meanwhile.
    Failed,
    /// Never loaded: search matches words only.
    Off,
}

/// A query as the search model sees it.
pub struct QueryVector {
    /// The model that embedded it; only passages embedded by the same model compare.
    pub model: String,
    /// The query at unit length, so its dot product with a passage's vector is their
    /// cosine similarity.
    pub vector: Vec<f32>,
}

impl EmbedderSlot {
    /// The embedder `config` selects, loaded the first time it is asked for.
    pub fn new(config: EmbedderConfig) -> Self {
        Self {
            config,
            state: Arc::default(),
        }
    }

    /// Always this embedder, for tests.
    pub fn with(embedder: Arc<dyn Embedder>) -> Self {
        Self {
            config: EmbedderConfig::default(),
            state: Arc::new(Mutex::new(State::Loaded(embedder))),
        }
    }

    /// Never loads the model, even when it is installed, so tests never run a real one.
    pub fn turn_off(&self) {
        *self.lock() = State::Off;
    }

    /// The model was just installed: one that failed to load is tried again.
    pub fn installed(&self) {
        let mut state = self.lock();
        if matches!(*state, State::Failed) {
            *state = State::Unloaded;
        }
    }

    /// The model, loading it the first time it is asked for once installed; `None` while it
    /// is not installed, turned off, or since it failed to load. Only the failure itself is
    /// an error; the next call is `None` without trying again. Loading takes a moment: call
    /// from a blocking context.
    pub fn get(&self) -> Result<Option<Arc<dyn Embedder>>> {
        // Held while loading, so callers at the same moment wait for one load, not start two.
        let mut state = self.lock();
        match &*state {
            State::Loaded(embedder) => return Ok(Some(embedder.clone())),
            State::Failed | State::Off => return Ok(None),
            State::Unloaded => {}
        }
        if !self.config.is_installed() {
            return Ok(None);
        }
        match self.config.load() {
            Ok(embedder) => {
                *state = State::Loaded(embedder.clone());
                Ok(Some(embedder))
            }
            Err(error) => {
                *state = State::Failed;
                Err(error)
            }
        }
    }

    /// `text` embedded as a query, to match passages by meaning; `None` when the model is
    /// not installed, turned off, or fails, which leaves only words to match. Failures are
    /// logged; a model that fails to load is logged once. Loads the model the first time:
    /// call from a blocking context.
    pub fn embed_query(&self, text: &str) -> Option<QueryVector> {
        let embedder = self.get().unwrap_or_else(|error| {
            tracing::warn!(
                error = format!("{error:#}"),
                "the search model did not load"
            );
            None
        })?;
        let vector = embedder
            .embed(&[text.to_owned()], Role::Query)
            .inspect_err(|error| {
                tracing::warn!(error = format!("{error:#}"), "cannot embed the query");
            })
            .ok()?
            .into_iter()
            .next()?;
        Some(QueryVector {
            model: embedder.model_id().to_owned(),
            vector,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use study_ai::embed::LocalConfig;

    use super::*;

    fn config(models: &Path) -> LocalConfig {
        LocalConfig {
            models_dir: Some(models.to_owned()),
        }
    }

    /// "Installs" the model as files of the pinned sizes that hold nothing, so it fails to
    /// load. The files are sparse: nothing is written.
    fn install_broken(models: &Path) {
        let install = config(models).model();
        let dir = install.dir().unwrap();
        for file in install.spec().files {
            let path = dir.join(file.name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::File::create(&path)
                .unwrap()
                .set_len(file.size)
                .unwrap();
        }
        assert!(install.is_installed());
    }

    #[test]
    fn a_model_that_fails_to_load_is_tried_again_only_once_installed() {
        let models = tempfile::tempdir().unwrap();
        let slot = EmbedderSlot::new(EmbedderConfig::Local(config(models.path())));
        // Not installed yet: looked for on every call.
        assert!(slot.get().unwrap().is_none());

        install_broken(models.path());
        assert!(slot.get().is_err());
        // Not tried again: search goes on with words only, without a warning per query.
        assert!(slot.get().unwrap().is_none());
        assert!(slot.embed_query("photosynthesis").is_none());

        slot.installed();
        assert!(slot.get().is_err());
        assert!(slot.get().unwrap().is_none());
    }
}
