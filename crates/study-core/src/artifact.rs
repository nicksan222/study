//! Study material generated from a project's sources. Every item that rests on a passage
//! names it by marker, as in an answer, so it can point back to the page or moment it came
//! from.
//!
//! A project has one piece of each [`ArtifactKind`]. It is written again as an update that
//! revises the current text and replaces it once finished; nothing older is kept. See
//! `db/artifacts.rs`.
//!
//! To add a kind of material, add it to [`ArtifactKind`], add an [`ArtifactBody`] variant if
//! it needs a new shape (and to `bodies()` in the tests), and name its shape in
//! [`ArtifactBody::fits`].

use serde::{Deserialize, Serialize};

crate::text_enum! {
    /// What kind of material an artifact is.
    pub enum ArtifactKind {
        /// Question and answer cards, reviewed with spaced repetition.
        Flashcards = "flashcards",
        /// A hand-drawn diagram of the ideas and how they connect: cards with details,
        /// joined by arrows.
        Diagram = "diagram",
    }
}

crate::text_enum! {
    /// How far writing an artifact has got; how its job ended is on the job.
    pub enum ArtifactStatus {
        Pending = "pending",
        Writing = "writing",
        Complete = "complete",
    }
}

/// The content of a finished artifact.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ArtifactBody {
    Flashcards {
        cards: Vec<Flashcard>,
    },
    /// A diagram as a Mermaid flowchart, which `study-diagram` reads and draws. Each card
    /// cites the passages it rests on as `[n]` in its label.
    Diagram {
        mermaid: String,
    },
}

impl ArtifactBody {
    /// Whether this body has the shape `kind` is written in: cards for flashcards, a
    /// diagram for a diagram.
    pub fn fits(&self, kind: ArtifactKind) -> bool {
        // Exhaustive over the kind, so a new kind must name the body it is written as.
        match kind {
            ArtifactKind::Flashcards => matches!(self, Self::Flashcards { .. }),
            ArtifactKind::Diagram => matches!(self, Self::Diagram { .. }),
        }
    }

    /// The material as plain text to paste elsewhere: a diagram as its Mermaid flowchart,
    /// and flashcards one per line as front, a tab, and back (what
    /// Anki and most flashcard apps import).
    pub fn exported(&self) -> String {
        // A card's own tabs and line breaks would split it in two.
        let field = crate::text::collapse_whitespace;
        match self {
            Self::Diagram { mermaid } => mermaid.trim().to_owned(),
            Self::Flashcards { cards } => cards
                .iter()
                .map(|card| format!("{}\t{}", field(&card.front), field(&card.back)))
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}

/// One card as written; once stored it is scheduled on its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Flashcard {
    pub front: String,
    pub back: String,
    /// Markers of the passages it rests on.
    #[serde(default)]
    pub cites: Vec<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn material_exports_as_text_other_apps_read() {
        let cards = ArtifactBody::Flashcards {
            cards: vec![Flashcard {
                front: "What makes\tATP?".into(),
                back: "Mitochondria,\nmostly".into(),
                cites: vec![1],
            }],
        };
        assert_eq!(cards.exported(), "What makes ATP?\tMitochondria, mostly");
        let diagram = ArtifactBody::Diagram {
            mermaid: "\nflowchart TD\n".into(),
        };
        assert_eq!(diagram.exported(), "flowchart TD");
    }

    fn bodies() -> [ArtifactBody; 2] {
        [
            ArtifactBody::Flashcards { cards: Vec::new() },
            ArtifactBody::Diagram {
                mermaid: "flowchart TD".into(),
            },
        ]
    }

    #[test]
    fn every_kind_fits_exactly_one_body_shape() {
        for kind in ArtifactKind::ALL {
            let fitting = bodies().iter().filter(|body| body.fits(*kind)).count();
            assert_eq!(fitting, 1, "{kind} must fit one `ArtifactBody` shape");
        }
    }

    #[test]
    fn every_body_shape_fits_some_kind() {
        for body in bodies() {
            assert!(
                ArtifactKind::ALL.iter().any(|kind| body.fits(*kind)),
                "{body:?} fits no `ArtifactKind`"
            );
        }
    }
}
