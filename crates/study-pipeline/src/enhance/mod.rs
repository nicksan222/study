//! The enhancers: one implementation of [`Enhancer`] per [`ArtifactKind`], run when the
//! user asks to make study material from chosen sources, such as "make flash
//! cards". The routes say which each kind of source offers. The `Artifact` job runs
//! the enhancer of its artifact's kind once the sources are read (it waits for them), with
//! numbered [`Excerpt`](study_core::processing::Excerpt)s it cites: every passage of the
//! sources, less what the [`Sifter`] (the tiny tier) drops as not worth studying, fitted to
//! the budget. So material spans a whole project, not a sample of it.
//!
//! | Enhancer          | Module        | Kind         | Made by                                                      |
//! |-------------------|---------------|--------------|--------------------------------------------------------------|
//! | [`CardWriter`]    | `material.rs` | `Flashcards` | an agent on the medium tier                                  |
//! | [`DiagramWriter`] | `diagram.rs`  | `Diagram`    | an agent on the smart tier, asked again to fix its flowchart |
//!
//! # Adding an enhancer
//!
//! Add its [`ArtifactKind`] (and its `CHECK` code) in `study-core` and offer it in the
//! routes it suits, then either:
//!
//! - **an agent**: a unit struct implementing [`AgentSpec`] with `Input = EnhancerInput`
//!   and `Output = ArtifactBody`, plus [`EnhancerAgent`] naming its kind (copy
//!   [`CardWriter`] in `material.rs`), and one [`agent`] line in
//!   [`EnhancerSet::builtin`]; or
//! - **anything else**: a type implementing [`Enhancer`] directly, and one line there.
//!
//! `every_artifact_kind_has_exactly_one_enhancer` fails until the kind has one; its
//! labels are in `study-localization`.

mod diagram;
mod handler;
mod material;
mod sift;

use diagram::DiagramWriter;
pub(crate) use handler::EnhanceHandler;
use material::CardWriter;
pub use sift::Sifter;

use std::marker::PhantomData;
use std::sync::Arc;

use study_ai::agent::{AgentRuntime, AgentSpec};
use study_core::processing::{BoxFuture, Enhancer, EnhancerInput};
use study_core::{ArtifactBody, ArtifactKind, Failure};

use crate::ProcessorSet;

/// An agent that writes material: an [`AgentSpec`] from [`EnhancerInput`] to an
/// [`ArtifactBody`], and the kind it writes.
trait EnhancerAgent: AgentSpec<Input = EnhancerInput, Output = ArtifactBody> {
    /// The kind of material it writes.
    const KIND: ArtifactKind;
}

/// An [`EnhancerAgent`] as an [`Enhancer`], on the model of its tier.
struct AgentEnhancer<S> {
    agents: AgentRuntime,
    spec: PhantomData<fn() -> S>,
}

/// `S` as an enhancer on `agents`: one line of [`EnhancerSet::builtin`].
fn agent<S: EnhancerAgent>(agents: &AgentRuntime) -> Arc<dyn Enhancer> {
    Arc::new(AgentEnhancer::<S> {
        agents: agents.clone(),
        spec: PhantomData,
    })
}

impl<S: EnhancerAgent> Enhancer for AgentEnhancer<S> {
    fn kind(&self) -> ArtifactKind {
        S::KIND
    }

    fn enhance<'a>(
        &'a self,
        material: &'a EnhancerInput,
    ) -> BoxFuture<'a, Result<ArtifactBody, Failure>> {
        Box::pin(async move {
            let runner = self.agents.required::<S>().await?;
            runner.run(material).await.map_err(Failure::from)
        })
    }
}

/// The enhancer of every [`ArtifactKind`].
pub type EnhancerSet = ProcessorSet<dyn Enhancer>;

impl EnhancerSet {
    /// Every enhancer Study ships, running agents on `agents`. This is the one list: a new
    /// enhancer is added here.
    pub fn builtin(agents: &AgentRuntime) -> Self {
        Self::new(vec![
            agent::<CardWriter>(agents),
            Arc::new(DiagramWriter::new(agents)),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::diagram::DiagramDrafter;
    use super::sift::PassageSifter;
    use super::*;

    #[test]
    fn every_artifact_kind_has_exactly_one_enhancer() {
        let (_dir, store) = study_core::db::Store::temporary().unwrap();
        let set = EnhancerSet::builtin(&AgentRuntime::saved(store));
        assert_eq!(set.missing(), []);
    }

    /// Agents are told apart in logs and traces by name, so a copied writer must be renamed.
    #[test]
    fn every_material_agent_has_its_own_name() {
        let names = [CardWriter::NAME, DiagramDrafter::NAME, PassageSifter::NAME];
        let distinct: std::collections::BTreeSet<_> = names.iter().collect();
        assert_eq!(distinct.len(), names.len(), "{names:?}");
    }
}
