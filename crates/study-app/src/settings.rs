//! Preferences, the model providers' connections, the processing switches, and the report
//! of what this computer can run.

use study_ai::catalog::Plan;
use study_ai::chat::Connections;
use study_ai::hardware::{self, Report};
use study_ai::stt::TranscriptionPreferences;
use study_core::Result;
use study_core::preferences::PreferenceSet;
use study_core::processing::{ProcessingPreferences, Processor};
use study_core::{JobKind, SourceKind};

use crate::App;

impl App {
    /// A group of saved preferences, with defaults for anything never saved.
    pub fn preferences<P: PreferenceSet>(&self) -> Result<P> {
        self.with(|database| P::load(database))
    }

    /// Saves a group of preferences.
    pub fn save_preferences<P: PreferenceSet>(&self, preferences: &P) -> Result<()> {
        self.with(|database| preferences.save(database))
    }

    /// The credentials every model provider signed in with, as saved.
    pub fn connections(&self) -> Result<Connections> {
        self.with(Connections::load)
    }

    /// What each kind of source goes through: the routes' defaults with the user's switches.
    pub fn processing(&self) -> Result<ProcessingPreferences> {
        self.preferences()
    }

    /// Switches `processor` on or off for sources of `kind`, and saves it in one step, so
    /// switches made at once never undo each other. Work queued before it that it switched
    /// off is skipped. Switching reading, the index or embedding on catches up on what
    /// waited for it; a refiner or material switch applies to what is read from now on
    /// (read a file again to apply it). Only a read whose refiner failed, not one that ran
    /// while the refiner was off, is read again for it, at start and at sign-in. The result
    /// is the save's: catching up is only logged when it fails, and happens again when work
    /// next starts.
    pub fn switch_processor(&self, kind: SourceKind, processor: Processor, on: bool) -> Result<()> {
        self.with(|database| ProcessingPreferences::save_switch(database, kind, processor, on))?;
        if on && let Err(error) = self.catch_up(processor) {
            tracing::warn!(
                error = format!("{error:#}"),
                "cannot queue what the switch allows"
            );
        }
        Ok(())
    }

    /// Queues the work `processor`, just switched on, has waiting.
    fn catch_up(&self, processor: Processor) -> Result<()> {
        match processor {
            Processor::Extractor(_) => self.queue_unread_sources(),
            Processor::Stage(JobKind::Index) => self.queue_missing_passages(),
            Processor::Stage(JobKind::Embed) => self.queue_missing_embeddings(),
            Processor::Stage(_) | Processor::Refiner(_) | Processor::Enhancer(_) => Ok(()),
        }
    }

    /// The saved measurement of this computer, if it has been measured.
    pub fn machine_report(&self) -> Result<Option<Report>> {
        self.with(Report::saved)
    }

    /// Measures this computer again and saves the report. Blocks for a few seconds.
    pub fn measure_machine(&self) -> Result<Report> {
        self.with(Report::measure_and_save)
    }

    /// The saved report, or a first measurement that is then saved and applied with
    /// [`apply_plan`](Self::apply_plan).
    pub async fn measure_machine_once(&self) -> Result<Report> {
        let hardware::Measurement { report, first } =
            hardware::measure_once(self.store()?.clone()).await?;
        if first {
            let plan = report.plan();
            self.blocking(move |app| app.apply_plan(&plan)).await?;
        }
        Ok(report)
    }

    /// Adopts what `plan` recommends for every setting the user never saved. A setting the
    /// user chose is never changed. Returns whether that changed anything.
    pub fn apply_plan(&self, plan: &Plan) -> Result<bool> {
        let Some(recommended) = TranscriptionPreferences::recommended(plan) else {
            return Ok(false);
        };
        self.with(|database| {
            let current = TranscriptionPreferences::load(database)?;
            let adopted = TranscriptionPreferences::load_or(database, recommended)?;
            if adopted == current {
                return Ok(false);
            }
            adopted.save(database)?;
            Ok(true)
        })
    }
}
