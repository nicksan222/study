//! [`Pipeline`]: the implementation of every processor kind, and the job handlers that run
//! them. What runs for which source is decided in `study-core`
//! ([`ROUTES`](study_core::processing::ROUTES) and the user's
//! [`ProcessingPreferences`](study_core::processing::ProcessingPreferences)); this is only
//! who does it.

use std::sync::Arc;

use study_ai::agent::AgentRuntime;
use study_core::db::Store;
use study_core::jobs::JobHandler;
use study_core::processing::{SourcePlan, Stage};

use crate::enhance::{EnhanceHandler, Sifter};
use crate::fetch::FetchHandler;
use crate::stages::{EmbedStage, ExtractStage, IndexStage, StageHandler};
use crate::{EmbedderSlot, EnhancerSet, ExtractorSet, FetcherSet, RefinerSet};

/// Every processor Study runs on raw input, by family. Clones share the processors.
#[derive(Clone)]
pub struct Pipeline {
    store: Store,
    fetchers: FetcherSet,
    extractors: ExtractorSet,
    refiners: RefinerSet,
    embedder: EmbedderSlot,
    enhancers: EnhancerSet,
    sifter: Sifter,
}

impl Pipeline {
    /// Every processor Study ships, reading their settings from `store`, running agents on
    /// `agents`, and embedding with the model in `embedder`.
    pub fn builtin(store: Store, agents: &AgentRuntime, embedder: EmbedderSlot) -> Self {
        Self {
            fetchers: FetcherSet::builtin(),
            extractors: ExtractorSet::builtin(store.clone(), agents),
            refiners: RefinerSet::builtin(agents),
            enhancers: EnhancerSet::builtin(agents),
            sifter: Sifter::new(agents),
            embedder,
            store,
        }
    }

    /// The same pipeline reading sources with `extractors` instead, such as test doubles.
    pub fn with_extractors(mut self, extractors: ExtractorSet) -> Self {
        self.extractors = extractors;
        self
    }

    /// The sifter the enhancers use. Clones share its decisions, so other work that sifts
    /// the same material, such as practice questions, sifts each passage once.
    pub fn sifter(&self) -> &Sifter {
        &self.sifter
    }

    /// The fetchers that bring links in.
    pub fn fetchers(&self) -> &FetcherSet {
        &self.fetchers
    }

    /// Whether this pipeline can read a source with this plan, as
    /// [`ExtractorSet::can_read`] decides.
    pub fn can_read(&self, plan: &SourcePlan) -> bool {
        self.extractors.can_read(plan)
    }

    /// The automatic stages: reading, then every stage a route can list.
    pub fn stages(&self) -> Vec<Arc<dyn Stage>> {
        vec![
            Arc::new(ExtractStage::new(
                self.store.clone(),
                self.extractors.clone(),
                self.refiners.clone(),
            )),
            Arc::new(IndexStage::new(self.store.clone())),
            Arc::new(EmbedStage::new(self.store.clone(), self.embedder.clone())),
        ]
    }

    /// A job handler for every stage, for the fetchers and for the enhancers: what the
    /// pipeline adds to the jobs engine.
    pub fn handlers(&self) -> Vec<Arc<dyn JobHandler>> {
        let mut handlers: Vec<Arc<dyn JobHandler>> = self
            .stages()
            .into_iter()
            .map(|stage| {
                Arc::new(StageHandler::new(self.store.clone(), stage)) as Arc<dyn JobHandler>
            })
            .collect();
        handlers.push(Arc::new(FetchHandler::new(
            self.store.clone(),
            self.fetchers.clone(),
            self.extractors.clone(),
        )));
        handlers.push(Arc::new(EnhanceHandler::new(
            self.store.clone(),
            self.enhancers.clone(),
            self.sifter.clone(),
        )));
        handlers
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::JobKind;
    use study_core::processing::ROUTES;

    #[test]
    fn every_stage_a_route_lists_has_an_implementation() {
        let (_dir, store) = Store::temporary().unwrap();
        let agents = AgentRuntime::saved(store.clone());
        let pipeline = Pipeline::builtin(store, &agents, EmbedderSlot::default());
        let kinds: Vec<JobKind> = pipeline.stages().iter().map(|stage| stage.kind()).collect();
        assert!(kinds.contains(&JobKind::Extract));
        for route in ROUTES {
            for step in route.stages {
                assert!(kinds.contains(&step.kind), "no stage runs {:?}", step.kind);
            }
        }
    }
}
