//! [`ModelSpec`]: a local model pinned to exact files, and what is on disk of it.

use std::path::{Path, PathBuf};

use crate::{Error, Result};

/// One file of a pinned model.
#[derive(Debug)]
pub struct ModelFile {
    /// Path relative to the model directory, `/`-separated as on Hugging Face.
    pub name: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// A model pinned to exact files on Hugging Face, so an upstream change can never swap the
/// weights silently.
#[derive(Debug)]
pub struct ModelSpec {
    /// Directory name under the models directory.
    pub id: &'static str,
    pub repository: &'static str,
    /// Git revision of `repository`.
    pub revision: &'static str,
    pub files: &'static [ModelFile],
}

impl ModelSpec {
    /// Total download size, for showing before the user commits to it.
    pub fn size_bytes(&self) -> u64 {
        self.files.iter().map(|file| file.size).sum()
    }

    /// `<models_dir>/<id>`; without a `models_dir`, the app's model cache.
    pub fn dir(&self, models_dir: Option<&Path>) -> Result<PathBuf> {
        let models_dir = match models_dir {
            Some(dir) => dir.to_owned(),
            None => study_core::paths::cache_dir()
                .ok_or_else(|| Error::Model("cannot locate the cache directory".into()))?
                .join("models"),
        };
        Ok(models_dir.join(self.id))
    }

    /// Files in `dir` that are absent or have the wrong size.
    pub fn missing_files(&self, dir: &Path) -> Vec<&ModelFile> {
        self.files
            .iter()
            .filter(|file| {
                std::fs::metadata(dir.join(file.name)).map_or(true, |meta| meta.len() != file.size)
            })
            .collect()
    }

    /// Whether every file is in `dir` at its pinned size.
    pub fn is_installed(&self, dir: &Path) -> bool {
        self.missing_files(dir).is_empty()
    }

    /// Downloads any missing files into `dir`, verifying each against its pinned size and
    /// SHA-256 before it is moved into place.
    pub async fn download(&self, dir: &Path) -> Result<()> {
        super::download::missing(self, dir).await
    }

    /// Fails naming the first file missing from `dir`. Loading calls this and never
    /// downloads: models are installed only when the user asks.
    pub fn require(&self, dir: &Path) -> Result<()> {
        match self.missing_files(dir).first() {
            Some(file) => Err(Error::Model(format!(
                "{} is not installed: {} is missing from {}",
                self.id,
                file.name,
                dir.display()
            ))),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: ModelSpec = ModelSpec {
        id: "tiny-model",
        repository: "example/tiny",
        revision: "0000000",
        files: &[
            ModelFile {
                name: "vocab.txt",
                size: 3,
                sha256: "",
            },
            ModelFile {
                name: "onnx/model.onnx",
                size: 5,
                sha256: "",
            },
        ],
    };

    #[test]
    fn a_model_is_installed_once_every_file_has_its_pinned_size() {
        let dir = tempfile::tempdir().unwrap();
        let dir = SPEC.dir(Some(dir.path())).unwrap();
        assert!(dir.ends_with("tiny-model"));
        assert_eq!(SPEC.size_bytes(), 8);
        assert_eq!(SPEC.missing_files(&dir).len(), 2);
        let error = SPEC.require(&dir).unwrap_err();
        assert!(error.to_string().contains("vocab.txt"), "{error}");

        std::fs::create_dir_all(dir.join("onnx")).unwrap();
        std::fs::write(dir.join("vocab.txt"), "abc").unwrap();
        // A file cut short counts as missing.
        std::fs::write(dir.join("onnx/model.onnx"), "ab").unwrap();
        let missing: Vec<_> = SPEC.missing_files(&dir).iter().map(|f| f.name).collect();
        assert_eq!(missing, ["onnx/model.onnx"]);
        assert!(!SPEC.is_installed(&dir));

        std::fs::write(dir.join("onnx/model.onnx"), "abcde").unwrap();
        assert!(SPEC.is_installed(&dir));
        SPEC.require(&dir).unwrap();
    }
}
