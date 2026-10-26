//! Persistent processing switches and lookup of a source's current plan.

use crate::db::{Database, Job, JobTarget};
use crate::preferences::{PreferenceSet, encode};
use crate::{JobKind, Requirement, Result, SourceId, SourceKind};

use super::Processor;
use super::plan::{ProcessingPreferences, Setting, SourcePlan, switch_setting};
use super::routes::{ROUTES, requirement};

#[cfg(test)]
mod tests;

impl ProcessingPreferences {
    /// Switches `processor` for sources of `kind` and saves just that switch, so switches
    /// saved at the same moment never undo each other.
    pub fn save_switch(
        database: &Database,
        kind: SourceKind,
        processor: Processor,
        on: bool,
    ) -> Result<()> {
        let value = match switch_setting(kind, processor, on) {
            None => return Ok(()),
            Some(Setting::Default) => None,
            Some(Setting::Override(on)) => Some(encode(&on)?),
        };
        database.set_preference(Self::SCOPE, &key(kind, processor), value.as_deref())
    }
}

/// The plan of the source a job's `target` is, or was read into; `None` once it is gone or
/// when the target is not a source's (a session, a message, material or a question).
pub fn plan_for(database: &Database, target: JobTarget) -> Result<Option<SourcePlan>> {
    let source = match target {
        JobTarget::Source(source) => Some(source),
        JobTarget::Document(document) => database.source_of_document(document)?,
        JobTarget::Session(_)
        | JobTarget::Message(_)
        | JobTarget::Artifact(_)
        | JobTarget::Question(_) => None,
    };
    let Some(source) = source.map(|id| database.source(id)).transpose()?.flatten() else {
        return Ok(None);
    };
    Ok(Some(
        ProcessingPreferences::load(database)?.plan(source.kind, &source.mime),
    ))
}

/// What `job` needs set up to run, by the plan its source has now, the user's switches
/// included: a read needs what the first extractor of that plan needs.
pub(crate) fn requirement_of(database: &Database, job: &Job) -> Result<Option<Requirement>> {
    let extractor = match job.kind {
        JobKind::Extract => {
            plan_for(database, job.target)?.and_then(|plan| plan.extractors.first().copied())
        }
        _ => None,
    };
    Ok(requirement(job.kind, extractor))
}

/// Sources whose document waits for a refiner that failed when it was read, needs
/// `requirement` and is still switched on, such as a transcript stored uncorrected before
/// anyone signed in, to read again once the requirement is met.
pub fn sources_missing_refiners(
    database: &Database,
    requirement: Requirement,
) -> Result<Vec<SourceId>> {
    let preferences = ProcessingPreferences::load(database)?;
    database.sources_missing_refiners(|kind, mime| {
        preferences
            .plan(kind, mime)
            .refiners
            .into_iter()
            .filter(|refiner| refiner.requirement() == Some(requirement))
            .collect()
    })
}

/// Where an override is stored, such as `audio.refiner.whitespace`.
fn key(kind: SourceKind, processor: Processor) -> String {
    format!("{}.{}", kind.code(), processor.code())
}

impl PreferenceSet for ProcessingPreferences {
    const SCOPE: &'static str = "processing";

    /// Reads the override of every processor any route offers. Anything else stored is a
    /// processor no route offers any more, and is dropped; a value that no longer reads is
    /// logged and dropped too, so one bad row never loses the other switches.
    fn load(database: &Database) -> Result<Self> {
        let stored = database.load_preferences(Self::SCOPE)?;
        let mut preferences = Self::default();
        for route in ROUTES {
            for (processor, _) in route.processors() {
                let key = key(route.source, processor);
                match stored.get::<bool>(&key) {
                    Ok(Some(on)) => preferences.set(route.source, processor, on),
                    Ok(None) => {}
                    Err(error) => {
                        tracing::warn!(key, error = format!("{error:#}"), "dropped a switch");
                    }
                }
            }
        }
        Ok(preferences)
    }

    fn save(&self, database: &Database) -> Result<()> {
        let entries = self
            .overrides
            .iter()
            .map(|((kind, processor), on)| Ok((key(*kind, *processor), encode(on)?)))
            .collect::<Result<Vec<(String, String)>>>()?;
        database.save_preferences(Self::SCOPE, &entries)
    }
}
