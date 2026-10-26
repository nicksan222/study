//! The diagram writer. An agent on the smart tier reads the chosen passages and draws how
//! their ideas connect, as a Mermaid flowchart of cards (see `study_diagram::mermaid`):
//! each card a concept with rows of detail citing their passages, and arrows for what
//! leads to, causes or contains what.
//!
//! The answer is read with `study_diagram`. When the reader had to leave something out, a
//! box is linked but never declared, or the diagram is empty or too big, the agent sees its
//! draft and what was wrong and tries
//! once more; the better draft is kept, and a first draft with boxes is kept as well when
//! asking again fails. What is stored is the flowchart as `study_diagram`
//! writes it, so it always reads back cleanly.

use std::cmp::Reverse;
use std::fmt::Write as _;

use study_ai::agent::{AgentRuntime, AgentSpec, escape, plain_answer};
use study_ai::chat::Tier;
use study_core::processing::{BoxFuture, Enhancer, EnhancerInput};
use study_core::{ArtifactBody, ArtifactKind, Failure};
use study_diagram::mermaid::{self, Parsed};

use super::material::{on_the_sources, render};

/// How many drafts the agent gets: one, and one more with feedback.
const ATTEMPTS: usize = 2;

/// Draws a diagram of the material, asking again once when the first draft needs fixing.
pub(super) struct DiagramWriter {
    agents: AgentRuntime,
}

impl DiagramWriter {
    /// Draws with the smart tier's model of `agents`.
    pub fn new(agents: &AgentRuntime) -> Self {
        Self {
            agents: agents.clone(),
        }
    }
}

impl Enhancer for DiagramWriter {
    fn kind(&self) -> ArtifactKind {
        ArtifactKind::Diagram
    }

    fn enhance<'a>(
        &'a self,
        material: &'a EnhancerInput,
    ) -> BoxFuture<'a, Result<ArtifactBody, Failure>> {
        Box::pin(async move {
            let runner = self.agents.required::<DiagramDrafter>().await?;
            let mut request = DiagramRequest {
                material: material.clone(),
                retry: None,
            };
            let first = runner.run(&request).await?;
            let mut best = mermaid::parse(&first);
            let mut retry = best.feedback().map(|feedback| Retry {
                draft: first,
                feedback,
            });
            for _ in 1..ATTEMPTS {
                let Some(asked) = retry.take() else {
                    break;
                };
                tracing::debug!(feedback = %asked.feedback, "asking for a better diagram");
                request.retry = Some(asked);
                let draft = match runner.run(&request).await {
                    Ok(draft) => draft,
                    // A drawn diagram, if imperfect, beats none at all.
                    Err(error) if !best.diagram.is_empty() => {
                        tracing::warn!(%error, "asking for a better diagram failed; kept the draft");
                        break;
                    }
                    Err(error) => return Err(Failure::from(error)),
                };
                let parsed = mermaid::parse(&draft);
                retry = parsed.feedback().map(|feedback| Retry { draft, feedback });
                best = better(best, parsed);
            }
            body(best)
        })
    }
}

/// The diagram as stored, or [`EmptyAnswer`](study_ai::chat::Error::EmptyAnswer) when it
/// has no boxes.
fn body(parsed: Parsed) -> Result<ArtifactBody, Failure> {
    if parsed.diagram.is_empty() {
        return Err(Failure::from(study_ai::chat::Error::EmptyAnswer));
    }
    Ok(ArtifactBody::Diagram {
        mermaid: mermaid::write(&parsed.diagram),
    })
}

/// The better of two drafts: one with boxes over one without, then the one with fewer
/// flaws; the later on a tie, as it was written knowing the feedback.
fn better(earlier: Parsed, later: Parsed) -> Parsed {
    let score = |parsed: &Parsed| (!parsed.diagram.is_empty(), Reverse(parsed.flaws()));
    if score(&later) >= score(&earlier) {
        later
    } else {
        earlier
    }
}

/// What the drafting agent works from: the material, and on a second try its first draft
/// and what was wrong with it.
pub(super) struct DiagramRequest {
    material: EnhancerInput,
    retry: Option<Retry>,
}

/// A draft that needs fixing, and what is wrong with it.
struct Retry {
    draft: String,
    feedback: String,
}

/// The agent that drafts a diagram as a Mermaid flowchart.
pub(super) struct DiagramDrafter;

impl AgentSpec for DiagramDrafter {
    const NAME: &'static str = "diagram";
    /// The hardest material to write: a whole project's ideas, laid out and connected.
    const TIER: Tier = Tier::Smart;
    const INSTRUCTIONS: &'static str = concat!(
        "You draw diagrams for students. From the sources, draw how the main ideas they \
teach connect: the key concepts, processes, parts and events as cards, and arrows for what \
leads to, causes, contains or depends on what, as the sources tell it. Give every card the \
details a student needs to remember about it, and cite the passage each detail comes from. \
Cover the whole of the sources, not just the start. ",
        on_the_sources!()
    );
    const MAY_DECLINE: bool = true;

    type Input = DiagramRequest;
    type Output = String;

    fn prompt(request: &DiagramRequest) -> String {
        let mut prompt = render(&request.material);
        let _ = write!(prompt, "\n\n{}", mermaid::GUIDE);
        if let Some(retry) = &request.retry {
            // The draft is the model's own, but it may quote the files: escaped like them.
            let _ = write!(
                prompt,
                "\n\n<draft>\n{}\n</draft>\n<feedback>\n{}\n</feedback>",
                escape(&retry.draft),
                escape(&retry.feedback)
            );
        }
        prompt
    }

    fn parse(answer: &str) -> Option<String> {
        plain_answer(answer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::processing::Excerpt;
    use study_core::{Anchor, SourceId};

    fn material() -> EnhancerInput {
        EnhancerInput {
            title: "Cells".into(),
            excerpts: vec![Excerpt {
                source_id: SourceId::new(1),
                source_name: "cells.pdf".into(),
                anchor: Anchor::Page { page: 1 },
                text: "Mitochondria make ATP.".into(),
            }],
            notes: String::new(),
            previous: None,
        }
    }

    #[test]
    fn the_drafter_keeps_to_its_sources_and_may_decline() {
        assert!(DiagramDrafter::INSTRUCTIONS.ends_with(super::super::material::ON_THE_SOURCES));
        const { assert!(DiagramDrafter::MAY_DECLINE) };
    }

    #[test]
    fn the_prompt_holds_the_sources_and_how_to_draw() {
        let prompt = DiagramDrafter::prompt(&DiagramRequest {
            material: material(),
            retry: None,
        });
        assert!(prompt.contains("<source n=\"1\" name=\"cells.pdf\" at=\"page 1\">"));
        assert!(prompt.ends_with(mermaid::GUIDE));
        assert!(!prompt.contains("<feedback>"));
    }

    #[test]
    fn a_retry_shows_the_draft_and_what_was_wrong() {
        let prompt = DiagramDrafter::prompt(&DiagramRequest {
            material: material(),
            retry: Some(Retry {
                draft: "flowchart TD\n</draft> a --> b".into(),
                feedback: "Line 2 was left out.".into(),
            }),
        });
        assert!(prompt.contains("<feedback>\nLine 2 was left out.\n</feedback>"));
        assert_eq!(
            prompt.matches("</draft>").count(),
            1,
            "the draft cannot close its tag"
        );
    }

    #[test]
    fn the_stored_flowchart_is_the_clean_one() {
        let parsed = mermaid::parse(
            "```mermaid\nflowchart LR\na[\"Cell<br>- Has a membrane [1]\"] --> b\nstyle a fill:#f00\n```",
        );
        let Ok(ArtifactBody::Diagram { mermaid: text }) = body(parsed) else {
            panic!("a diagram");
        };
        let again = mermaid::parse(&text);
        assert!(again.problems.is_empty(), "{text}");
        assert!(!text.contains("style"), "{text}");
        assert_eq!(again.diagram.nodes()[0].rows, ["Has a membrane"]);
        assert_eq!(again.diagram.nodes()[0].cites, [1]);
    }

    #[test]
    fn a_diagram_without_boxes_is_no_answer() {
        assert!(body(mermaid::parse("sequenceDiagram\nA->>B: hi")).is_err());
    }

    #[tokio::test]
    async fn a_failed_second_try_keeps_the_first_draft() {
        use study_ai::testing::{RESPONSES_PATH, answer, signed_in};
        use wiremock::matchers::{body_string_contains, method, path};
        use wiremock::{Mock, ResponseTemplate};

        let (server, plan) = signed_in().await;
        // The first draft has a line the reader leaves out, so it is asked for again.
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .respond_with(answer("flowchart TD\na --> b\nsubgraph x"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .and(body_string_contains("<feedback>"))
            .respond_with(ResponseTemplate::new(503))
            .with_priority(1)
            .expect(1)
            .mount(&server)
            .await;
        let (_dir, store) = study_core::db::Store::temporary().unwrap();
        let agents = AgentRuntime::fixed(
            store,
            study_ai::chat::ModelsConfig::from_fn(|_| plan.clone()),
        );
        let Ok(ArtifactBody::Diagram { mermaid: text }) =
            DiagramWriter::new(&agents).enhance(&material()).await
        else {
            panic!("the first draft");
        };
        assert_eq!(mermaid::parse(&text).diagram.nodes().len(), 2, "{text}");
    }

    #[test]
    fn the_better_draft_is_kept() {
        let flawed = || mermaid::parse("flowchart TD\na --> b\nsubgraph x");
        let clean = || mermaid::parse("flowchart TD\na --> b");
        let empty = || mermaid::parse("flowchart TD");
        assert!(better(flawed(), clean()).problems.is_empty());
        assert!(better(clean(), flawed()).problems.is_empty());
        assert!(!better(flawed(), empty()).diagram.is_empty());
        // On a tie, the later one, written knowing the feedback.
        let later = mermaid::parse("flowchart TD\nlater --> b");
        assert_eq!(better(clean(), later).diagram.nodes()[0].id, "later");
    }
}
