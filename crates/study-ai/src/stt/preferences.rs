//! What the user chose for transcription, stored under the `transcription` scope, and how
//! that becomes a running [`TranscriberConfig`]. Speech is always heard on this computer.

use study_core::preferences::Count;

use crate::BatchingConfig;
use crate::catalog::Plan;
use crate::stt::TranscriberConfig;
use crate::stt::provider::{LocalConfig, ProviderConfig};

/// How many copies of the local model load at once.
pub type ModelCopies = Count<{ crate::catalog::TRANSCRIBER_MAX_INSTANCES }>;

study_core::preferences! {
    /// How the local model transcribes audio.
    #[preferences(scope = "transcription", form = TranscriptionForm)]
    pub struct TranscriptionPreferences {
        /// Copies of the local model loaded at once; each costs about
        /// [`TRANSCRIBER_INSTANCE_BYTES`](crate::catalog::TRANSCRIBER_INSTANCE_BYTES) of memory.
        pub local_instances: ModelCopies = Count::ONE,
    }
}

impl TranscriptionPreferences {
    /// What `plan` recommends, or `None` when transcription does not suit this computer.
    pub fn recommended(plan: &Plan) -> Option<Self> {
        plan.transcription_instances
            .map(|local_instances| Self { local_instances })
    }

    /// The setup a transcriber starts with.
    pub fn transcriber_config(&self) -> TranscriberConfig {
        TranscriberConfig {
            provider: ProviderConfig::Local(LocalConfig {
                instances: self.local_instances.as_usize(),
                ..LocalConfig::default()
            }),
            batching: BatchingConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::db::Database;

    #[test]
    fn a_fresh_database_uses_one_copy_of_the_local_model() -> study_core::Result<()> {
        let (_dir, database) = Database::temporary()?;
        let preferences = TranscriptionPreferences::load(&database)?;
        assert_eq!(preferences, TranscriptionPreferences::default());
        assert!(matches!(
            preferences.transcriber_config().provider,
            ProviderConfig::Local(LocalConfig { instances: 1, .. })
        ));
        Ok(())
    }

    #[test]
    fn the_form_round_trips() {
        let form = TranscriptionForm {
            local_instances: "2".into(),
        };
        let preferences = form.parse().unwrap();
        assert_eq!(preferences.local_instances.as_usize(), 2);
        assert_eq!(
            TranscriptionForm::from(&preferences).parse().unwrap(),
            preferences
        );
    }
}
