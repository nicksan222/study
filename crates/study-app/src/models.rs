//! The local models Study runs on this computer: speech-to-text, because the ChatGPT plan
//! takes no audio, and the search model, because embedding is cheap. None downloads by
//! itself: each is installed when the user asks, and work that failed for want of it starts
//! again. Every other model runs on the user's ChatGPT plan.

use study_ai::{ModelInstall, embed, stt};
use study_core::Result;
use study_core::{ErrorKind, JobKind, Requirement};

use crate::App;

/// A model Study can run on this computer once installed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LocalModel {
    /// Speech-to-text, for recordings and videos.
    Transcription,
    /// Embeddings, for search by meaning. Without it search matches keywords only.
    Search,
}

impl LocalModel {
    /// The model's pinned files in the app's model cache.
    fn files(self) -> ModelInstall {
        match self {
            Self::Transcription => stt::provider::LocalConfig::default().model(),
            Self::Search => embed::LocalConfig::default().model(),
        }
    }
}

impl App {
    /// Whether every file of `model` is on disk.
    pub fn model_installed(&self, model: LocalModel) -> bool {
        model.files().is_installed()
    }

    /// Download size of `model` in bytes, to show before installing it.
    pub fn model_size(&self, model: LocalModel) -> u64 {
        model.files().size_bytes()
    }

    /// Downloads and verifies `model`, then queues the work that was waiting for it: reads
    /// that failed without it, or embeddings for everything read so far.
    pub async fn install_model(&self, model: LocalModel) -> Result<()> {
        model.files().install().await?;
        self.blocking(move |app| match model {
            LocalModel::Search => {
                app.embedder().installed();
                app.queue_missing_embeddings()
            }
            LocalModel::Transcription => {
                app.release_waiting(Requirement::Transcription)?;
                app.retry_failed(&[JobKind::Extract], &[ErrorKind::ModelUnavailable])?;
                Ok(())
            }
        })
        .await
    }
}
