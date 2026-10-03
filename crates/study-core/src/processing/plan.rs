//! [`ProcessingPreferences`]: the user's overrides of the routes' defaults, and
//! [`SourcePlan`], what actually runs for one source once they are applied.

use std::collections::BTreeMap;

use crate::{ArtifactKind, JobKind, SourceKind};

use super::routes::{ROUTES, Route, Step, route};
use super::{ExtractorKind, Processor, RefinerKind};

/// Processors the user switched on or off for a kind of source, against its route's
/// defaults. Only what differs from the default is stored.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProcessingPreferences {
    pub(super) overrides: BTreeMap<(SourceKind, Processor), bool>,
}

/// One processor as a route offers it, for the Settings page.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Switch {
    pub processor: Processor,
    /// The route's default.
    pub default: bool,
    /// What it is now.
    pub on: bool,
}

impl ProcessingPreferences {
    /// Whether `processor` runs for sources of `kind`: the user's choice, else the default
    /// of the first route of that kind offering it; `false` when no route offers it.
    pub fn is_on(&self, kind: SourceKind, processor: Processor) -> bool {
        self.overrides
            .get(&(kind, processor))
            .copied()
            .or_else(|| default_of(kind, processor))
            .unwrap_or(false)
    }

    /// Switches `processor` on or off for sources of `kind`. Setting it back to its default
    /// forgets the override. A processor no route of `kind` offers has no switch: the call
    /// is ignored.
    pub fn set(&mut self, kind: SourceKind, processor: Processor, on: bool) {
        match switch_setting(kind, processor, on) {
            None => {}
            Some(Setting::Default) => {
                self.overrides.remove(&(kind, processor));
            }
            Some(Setting::Override(on)) => {
                self.overrides.insert((kind, processor), on);
            }
        }
    }

    /// Every processor a route of `kind` offers, once each: extractors, then refiners,
    /// stages and enhancers, each family in route order.
    pub fn switches(&self, kind: SourceKind) -> Vec<Switch> {
        let mut switches: Vec<Switch> = Vec::new();
        for route in ROUTES.iter().filter(|route| route.source == kind) {
            for (processor, default) in route.processors() {
                if switches.iter().all(|switch| switch.processor != processor) {
                    switches.push(Switch {
                        processor,
                        default,
                        on: self.is_on(kind, processor),
                    });
                }
            }
        }
        switches.sort_by_key(|switch| family(switch.processor));
        switches
    }

    /// What runs for a source of this kind and media type; empty when no route covers it.
    /// Only the first route that covers the source counts: switching off its extractors
    /// leaves the source unread rather than falling through to another route.
    pub fn plan(&self, kind: SourceKind, mime: &str) -> SourcePlan {
        let Some(route) = route(kind, mime) else {
            return SourcePlan::default();
        };
        let on = |processor| self.is_on(kind, processor);
        SourcePlan {
            extractors: enabled(route.extractors, |k| on(Processor::Extractor(k))),
            refiners: enabled(route.refiners, |k| on(Processor::Refiner(k))),
            stages: with_foundations(enabled(route.stages, |k| on(Processor::Stage(k)))),
            enhancers: enabled(route.enhancers, |k| on(Processor::Enhancer(k))),
        }
    }
}

/// What runs for one source.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SourcePlan {
    /// Tried in order; empty when the source is not read.
    pub extractors: Vec<ExtractorKind>,
    pub refiners: Vec<RefinerKind>,
    /// The automatic stages after reading, in order.
    pub stages: Vec<JobKind>,
    /// Material the user can make from it.
    pub enhancers: Vec<ArtifactKind>,
}

impl SourcePlan {
    /// Whether the source is read at all, so whether its Extract job is queued.
    pub fn reads(&self) -> bool {
        !self.extractors.is_empty()
    }

    /// Whether a job of `kind` has work to do for this source: reading when it is read,
    /// otherwise a stage the plan includes. A job queued before the user switched its stage
    /// off is skipped, and the chain stops there; the stages after it build on it.
    pub fn includes(&self, kind: JobKind) -> bool {
        if kind == JobKind::Extract {
            self.reads()
        } else {
            self.stages.contains(&kind)
        }
    }

    /// The stage that follows `stage` for this source: the first stage after reading for
    /// [`JobKind::Extract`], otherwise the next one in the plan; `None` at the end.
    pub fn after(&self, stage: JobKind) -> Option<JobKind> {
        if stage == JobKind::Extract {
            return self.stages.first().copied();
        }
        let at = self.stages.iter().position(|kind| *kind == stage)?;
        self.stages.get(at + 1).copied()
    }
}

fn enabled<K: Copy>(steps: &[Step<K>], on: impl Fn(K) -> bool) -> Vec<K> {
    steps
        .iter()
        .map(|step| step.kind)
        .filter(|kind| on(*kind))
        .collect()
}

/// `stages` without any whose foundation ([`JobKind::builds_on`]) was not kept before it:
/// an Embed with no Index has no passages to embed. Routes list a foundation before what
/// builds on it, so one pass in order drops whole chains.
fn with_foundations(stages: Vec<JobKind>) -> Vec<JobKind> {
    let mut kept: Vec<JobKind> = Vec::new();
    for stage in stages {
        if stage.builds_on().is_none_or(|base| kept.contains(&base)) {
            kept.push(stage);
        }
    }
    kept
}

/// Where a processor's family comes in a route: extractors, refiners, stages, enhancers.
fn family(processor: Processor) -> u8 {
    match processor {
        Processor::Extractor(_) => 0,
        Processor::Refiner(_) => 1,
        Processor::Stage(_) => 2,
        Processor::Enhancer(_) => 3,
    }
}

/// What a switch stores: nothing when it is at its route's default, else its value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Setting {
    Default,
    Override(bool),
}

/// What switching `processor` to `on` for `kind` stores; `None` when no route of `kind`
/// offers it, so it has no switch.
pub(super) fn switch_setting(kind: SourceKind, processor: Processor, on: bool) -> Option<Setting> {
    let Some(default) = default_of(kind, processor) else {
        tracing::warn!(?kind, ?processor, "no route offers this processor");
        return None;
    };
    Some(if on == default {
        Setting::Default
    } else {
        Setting::Override(on)
    })
}

/// The default of `processor` in the first route of `kind` offering it.
fn default_of(kind: SourceKind, processor: Processor) -> Option<bool> {
    ROUTES
        .iter()
        .filter(|route| route.source == kind)
        .flat_map(Route::processors)
        .find(|(offered, _)| *offered == processor)
        .map(|(_, default)| default)
}

#[cfg(test)]
mod tests;
