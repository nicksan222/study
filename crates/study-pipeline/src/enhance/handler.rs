//! Runs enhancers as the `Artifact` job: once the chosen sources are read (the job waits
//! for them), and again whenever the user retries. Every passage of the sources is
//! [sifted](super::Sifter) first, then fitted to what the enhancer is shown.

use std::sync::Arc;

use study_core::db::{Database, Job, NewJob, Store};
use study_core::jobs::{JobHandler, Lane, wrong_target};
use study_core::processing::{BoxFuture, Enhancer, EnhancerInput, Excerpt};
use study_core::{
    ArtifactBody, ArtifactId, ArtifactStatus, Citation, ErrorKind, Failure, JobKind, cited_markers,
};

use super::{EnhancerSet, Sifter};
use crate::index::excerpts_of_sources;

/// Writes artifacts with the enhancer of their kind.
pub struct EnhanceHandler {
    store: Store,
    enhancers: EnhancerSet,
    sifter: Sifter,
}

impl EnhanceHandler {
    /// Writes with `enhancers` from what `sifter` keeps, into `store`.
    pub fn new(store: Store, enhancers: EnhancerSet, sifter: Sifter) -> Self {
        Self {
            store,
            enhancers,
            sifter,
        }
    }

    /// Writes artifact `id`, unless it is finished or gone. It is marked as being written
    /// only once there is an enhancer for it and something read to write from, so a failure
    /// before then leaves it pending.
    async fn write(&self, id: ArtifactId) -> Result<(), Failure> {
        let enhancers = self.enhancers.clone();
        let start = self
            .store
            .run(move |database| begin(database, &enhancers, id))
            .await?;
        let (enhancer, title, notes, previous, excerpts) = match start {
            Start::Write {
                enhancer,
                title,
                notes,
                previous,
                excerpts,
            } => (enhancer, title, notes, previous, excerpts),
            Start::Skip => return Ok(()),
            Start::Refuse(failure) => return Err(failure),
        };
        let excerpts = self.sifter.sift(&title, excerpts).await?;
        let material = EnhancerInput::fit(title, notes, previous, excerpts);
        let body = enhancer.enhance(&material).await?;
        let citations = citations(&body, &material.excerpts);
        self.store
            .run(move |database| database.finish_artifact(id, &body, &citations))
            .await?;
        Ok(())
    }
}

impl JobHandler for EnhanceHandler {
    fn kind(&self) -> JobKind {
        JobKind::Artifact
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(artifact) = job.target.artifact() else {
                return Err(wrong_target(&job));
            };
            self.write(artifact).await?;
            Ok(Vec::new())
        })
    }
}

/// What [`begin`] found an artifact's job has to do.
enum Start {
    /// Write it: the enhancer of its kind, and what it is written from, every passage of
    /// its sources.
    Write {
        enhancer: Arc<dyn Enhancer>,
        title: String,
        /// The project's notes as the update was asked for.
        notes: String,
        /// The current text the update replaces, to revise.
        previous: Option<ArtifactBody>,
        excerpts: Vec<Excerpt>,
    },
    /// Nothing: it is finished, gone, or being written already.
    Skip,
    /// Fail the job, leaving the artifact pending.
    Refuse(Failure),
}

/// Marks artifact `id` as being written and gathers what it is written from, when it has an
/// enhancer and something to write from.
fn begin(
    database: &Database,
    enhancers: &EnhancerSet,
    id: ArtifactId,
) -> study_core::Result<Start> {
    let Some(artifact) = database.artifact(id)? else {
        return Ok(Start::Skip);
    };
    // A finished artifact keeps its cards and their reviews, whatever reran its job.
    if artifact.status == ArtifactStatus::Complete {
        return Ok(Start::Skip);
    }
    let Some(enhancer) = enhancers.get(artifact.kind).cloned() else {
        return Ok(Start::Refuse(Failure::new(
            ErrorKind::Internal,
            format!("no enhancer makes {:?}", artifact.kind),
        )));
    };
    let excerpts = excerpts_of_sources(database, &artifact.sources)?;
    // Material may rest on the project's notes alone.
    if excerpts.is_empty() && artifact.notes.trim().is_empty() {
        return Ok(Start::Refuse(Failure::new(
            ErrorKind::Unsupported,
            "nothing has been read from these files",
        )));
    }
    if !database.begin_artifact(id)? {
        return Ok(Start::Skip);
    }
    Ok(Start::Write {
        enhancer,
        title: artifact.title,
        notes: artifact.notes,
        previous: database.current_of(id)?.and_then(|current| current.body),
        excerpts,
    })
}

/// The passages a body cites, each once, in marker order.
fn citations(body: &ArtifactBody, excerpts: &[Excerpt]) -> Vec<Citation> {
    let max = excerpts.len() as u32;
    let markers: Vec<u32> = match body {
        ArtifactBody::Text { text } => cited_markers(text, max),
        ArtifactBody::Flashcards { cards } => {
            cards.iter().flat_map(|card| card.cites.clone()).collect()
        }
        ArtifactBody::Diagram { mermaid } => study_diagram::mermaid::parse(mermaid)
            .diagram
            .nodes()
            .iter()
            .flat_map(|node| node.cites.clone())
            .collect(),
    };
    study_core::processing::citations(excerpts, markers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::{Anchor, Flashcard, SourceId};

    fn excerpts(count: u32) -> Vec<Excerpt> {
        (1..=count)
            .map(|page| Excerpt {
                source_id: SourceId::new(1),
                source_name: "cells.pdf".into(),
                anchor: Anchor::Page { page },
                text: format!("page {page}"),
            })
            .collect()
    }

    fn markers(citations: &[Citation]) -> Vec<u32> {
        citations.iter().map(|citation| citation.marker).collect()
    }

    #[test]
    fn a_text_cites_each_listed_passage_once_in_marker_order() {
        let body = ArtifactBody::Text {
            text: "ATP [3]. Membranes [1][3]. Nothing [9].".into(),
        };
        let cited = citations(&body, &excerpts(3));
        assert_eq!(markers(&cited), [1, 3]);
        assert_eq!(cited[1].quote, "page 3");
        assert_eq!(cited[1].anchor, Anchor::Page { page: 3 });
    }

    #[test]
    fn cards_and_diagrams_cite_what_their_items_rest_on() {
        let card = |cites: Vec<u32>| Flashcard {
            front: "Q".into(),
            back: "A".into(),
            cites,
        };
        let cards = ArtifactBody::Flashcards {
            cards: vec![card(vec![2, 7]), card(vec![2, 1])],
        };
        assert_eq!(markers(&citations(&cards, &excerpts(3))), [1, 2]);

        let diagram = ArtifactBody::Diagram {
            mermaid: "flowchart TD\na[\"Cell<br>- Has a membrane [2]\"] --> b".into(),
        };
        assert_eq!(markers(&citations(&diagram, &excerpts(3))), [2]);
    }

    /// Records what each write is shown and answers with a text.
    struct Recording(std::sync::Mutex<Vec<EnhancerInput>>);

    impl Enhancer for Recording {
        fn kind(&self) -> study_core::ArtifactKind {
            study_core::ArtifactKind::Notes
        }

        fn enhance<'a>(
            &'a self,
            material: &'a EnhancerInput,
        ) -> BoxFuture<'a, Result<ArtifactBody, Failure>> {
            Box::pin(async move {
                let mut seen = self.0.lock().unwrap();
                seen.push(material.clone());
                Ok(ArtifactBody::Text {
                    text: format!("version {}", seen.len()),
                })
            })
        }
    }

    #[tokio::test]
    async fn an_update_is_shown_the_current_text_and_the_first_is_shown_none() {
        use study_core::db::{MessageRole, NewPart, read_nothing};

        let (_dir, store) = study_core::db::Store::temporary().unwrap();
        let recording = Arc::new(Recording(Default::default()));
        let handler = EnhanceHandler::new(
            store.clone(),
            EnhancerSet::new(vec![recording.clone()]),
            Sifter::new(&study_ai::agent::AgentRuntime::saved(store.clone())),
        );
        let (project, first) = store
            .run(|database| {
                let project = database.create_project("Biology")?;
                let session = database.create_session(project.id, "Lecture")?;
                database.post_message(
                    session.id,
                    MessageRole::User,
                    &[NewPart::Text("Cells burn sugar.".into())],
                    &read_nothing,
                )?;
                let (first, _) =
                    database.request_update(project.id, study_core::ArtifactKind::Notes, &[])?;
                Ok((project.id, first))
            })
            .await
            .unwrap();
        handler.write(first).await.unwrap();
        let second = store
            .run(move |database| {
                Ok(database
                    .request_update(project, study_core::ArtifactKind::Notes, &[])?
                    .0)
            })
            .await
            .unwrap();
        handler.write(second).await.unwrap();

        let seen = recording.0.lock().unwrap();
        assert_eq!(seen[0].previous, None);
        assert_eq!(seen[0].notes, "Cells burn sugar.");
        assert_eq!(
            seen[1].previous,
            Some(ArtifactBody::Text {
                text: "version 1".into()
            })
        );
        assert!(
            crate::enhance::material::render(&seen[1]).contains("<previous_version>"),
            "revised, not written from nothing"
        );
        assert!(!crate::enhance::material::render(&seen[0]).contains("<previous_version>"));
    }
}
