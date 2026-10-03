//! [`ModelInstall`]: one pinned model at its place on disk, the one shape every local model
//! is installed and found through.

use std::path::PathBuf;

use super::ModelSpec;
use crate::Result;

/// A [`ModelSpec`] in a models directory: whether it is on disk, how big it is, installing
/// it, and finding it to load. Each local capability's config hands one out, so installing
/// speech-to-text and installing search are the same call.
#[derive(Clone, Debug)]
pub struct ModelInstall {
    spec: &'static ModelSpec,
    models_dir: Option<PathBuf>,
}

impl ModelInstall {
    /// `spec` under `models_dir`; without one, the app's model cache.
    pub fn new(spec: &'static ModelSpec, models_dir: Option<PathBuf>) -> Self {
        Self { spec, models_dir }
    }

    /// The pinned files this install is of.
    pub fn spec(&self) -> &'static ModelSpec {
        self.spec
    }

    /// The directory the model's files go in.
    pub fn dir(&self) -> Result<PathBuf> {
        self.spec.dir(self.models_dir.as_deref())
    }

    /// Download size in bytes, for showing before the user commits to it.
    pub fn size_bytes(&self) -> u64 {
        self.spec.size_bytes()
    }

    /// Whether every file is on disk, so loading needs no network.
    pub fn is_installed(&self) -> bool {
        self.dir().is_ok_and(|dir| self.spec.is_installed(&dir))
    }

    /// Downloads and verifies any missing files, without loading the model.
    pub async fn install(&self) -> Result<()> {
        self.spec.download(&self.dir()?).await
    }

    /// The directory to load the model from; fails, naming a missing file, when it is not
    /// installed. Never downloads: models are installed only when the user asks.
    pub fn require(&self) -> Result<PathBuf> {
        let dir = self.dir()?;
        self.spec.require(&dir)?;
        Ok(dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ModelFile;

    static SPEC: ModelSpec = ModelSpec {
        id: "tiny-model",
        repository: "example/tiny",
        revision: "0000000",
        files: &[ModelFile {
            name: "weights.bin",
            size: 3,
            sha256: "",
        }],
    };

    #[test]
    fn a_model_is_required_from_its_directory_once_installed() {
        let models = tempfile::tempdir().unwrap();
        let install = ModelInstall::new(&SPEC, Some(models.path().to_owned()));
        assert_eq!(install.dir().unwrap(), models.path().join("tiny-model"));
        assert_eq!(install.size_bytes(), 3);
        assert!(!install.is_installed());
        assert!(install.require().is_err());

        std::fs::create_dir_all(install.dir().unwrap()).unwrap();
        std::fs::write(install.dir().unwrap().join("weights.bin"), "abc").unwrap();
        assert!(install.is_installed());
        assert_eq!(install.require().unwrap(), install.dir().unwrap());
    }
}
