//! The material agents. Each is an agent on the medium tier that reads numbered passages
//! of the chosen sources and cites them: notes in Markdown with `[n]`
//! markers, and flashcards as JSON items with the markers they rest on.
//!
//! Every one keeps to what its sources specifically teach (`on_the_sources!`) and
//! [declines](AgentSpec::MAY_DECLINE) when they hold too little, rather than fall back on
//! general knowledge of the subject.

use std::fmt::Write as _;

use serde::Deserialize;
use study_ai::agent::{AgentSpec, escape, json_answer, numbered_sources, plain_answer};
use study_ai::chat::Tier;
use study_core::processing::EnhancerInput;
use study_core::{ArtifactBody, ArtifactKind, Flashcard};

use super::EnhancerAgent;

/// What every writer of material is told about its sources: they are the student's own, and
/// what it writes rests on what they specifically say. A macro, so it joins each agent's
/// instructions with `concat!`.
macro_rules! on_the_sources {
    () => {
        "The sources are numbered passages from the student's own lectures, slides, \
recordings and notes. Keep to what these sources specifically teach: their own facts, \
definitions, examples, figures, names and arguments. Never add general or background \
knowledge of the subject that they do not state, and never write anything a student could \
get right without having studied this material."
    };
}
pub(super) use on_the_sources;

/// [`on_the_sources!`] as a constant, for tests and docs.
#[cfg(test)]
pub(super) const ON_THE_SOURCES: &str = on_the_sources!();

/// What every writer is told when a version before this one is shown: the new one revises
/// it rather than starting over.
const REVISE: &str = "A previous version of this material follows in <previous_version>. \
Revise it: keep what the sources still support, keep the wording of every flashcard front \
and the structure of every note and diagram when they are still valid, add what is new in \
the sources, and drop what they no longer support. Cite only the numbered sources above: \
the previous version's citations were removed, because the numbers may now mean other \
sources.";

/// The prompt every material agent reads: the title, then the numbered sources, the
/// student's notes when there are any, and the version to revise when there is one.
pub(super) fn render(material: &EnhancerInput) -> String {
    // The title is the user's: escaped, so it cannot close a tag.
    let mut prompt = format!(
        "<title>{}</title>\n{}",
        escape(&material.title),
        numbered_sources(&material.excerpts)
    );
    if !material.notes.trim().is_empty() {
        let _ = write!(
            prompt,
            "\nThe student wrote <notes> in their study sessions: use them as material too, \
but they have no number to cite.\n<notes>\n{}\n</notes>",
            escape(material.notes.trim())
        );
    }
    if let Some(previous) = &material.previous {
        // The earlier body is the model's own, but it may quote the files: escaped like them.
        let _ = write!(
            prompt,
            "\n{REVISE}\n<previous_version>\n{}\n</previous_version>",
            escape(&previous_text(previous))
        );
    }
    prompt
}

/// `body` as a model reads it: Markdown, a card per line with its sides apart, or Mermaid,
/// without its `[n]` markers, which counted the excerpts of the version it was written from.
fn previous_text(body: &ArtifactBody) -> String {
    match body {
        ArtifactBody::Text { text } => without_markers(text),
        ArtifactBody::Flashcards { cards } => cards
            .iter()
            .map(|card| format!("Front: {}\nBack: {}", card.front, card.back))
            .collect::<Vec<_>>()
            .join("\n\n"),
        ArtifactBody::Diagram { mermaid } => without_markers(mermaid),
    }
}

/// `text` without the citation markers `[3]`, `[1, 2]` (the form
/// [`study_core::cited_markers`] reads), and the space before each.
fn without_markers(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let marker = after.find(']').filter(|&close| {
            let inside = &after[..close];
            inside.chars().any(|c| c.is_ascii_digit())
                && inside
                    .chars()
                    .all(|c| c.is_ascii_digit() || matches!(c, ',' | ';' | ' '))
        });
        match marker {
            Some(close) => {
                kept.push_str(rest[..open].trim_end_matches(' '));
                rest = &after[close + 1..];
            }
            None => {
                kept.push_str(&rest[..=open]);
                rest = after;
            }
        }
    }
    kept.push_str(rest);
    kept
}

/// Structured study notes.
pub(super) struct NotesWriter;

impl EnhancerAgent for NotesWriter {
    const KIND: ArtifactKind = ArtifactKind::Notes;
}

impl AgentSpec for NotesWriter {
    const NAME: &'static str = "notes";
    const TIER: Tier = Tier::Medium;
    const INSTRUCTIONS: &'static str = concat!(
        "You write study notes for students. Turn the sources into clear notes: a \
heading per topic they cover, short bullet points under it, key terms in bold, and \
definitions and formulas exactly as given. Cover every topic of the sources, from first to \
last, not just the start. After each point, cite the passage it comes from as [n], or \
several as [1][3]. Reply with the notes only, in Markdown. ",
        on_the_sources!()
    );
    const MAY_DECLINE: bool = true;

    type Input = EnhancerInput;
    type Output = ArtifactBody;

    fn prompt(material: &EnhancerInput) -> String {
        render(material)
    }

    fn parse(answer: &str) -> Option<ArtifactBody> {
        text_body(answer)
    }
}

/// Most flashcards one set keeps; the writer is asked for no more.
const MAX_CARDS: usize = 40;

/// Flashcards for spaced repetition.
pub(super) struct CardWriter;

impl EnhancerAgent for CardWriter {
    const KIND: ArtifactKind = ArtifactKind::Flashcards;
}

impl AgentSpec for CardWriter {
    const NAME: &'static str = "flashcards";
    const TIER: Tier = Tier::Medium;
    const INSTRUCTIONS: &'static str = concat!(
        "You write flashcards for students. From the sources, write up to 40 \
flashcards that test the key facts, definitions and ideas they teach, one idea per card, \
spread over every topic of the sources, not just the start; fewer cards when the sources \
hold fewer, never padding. The front is a precise question \
about something the sources say; the back is a short answer that stands alone, as the \
sources give it. Reply with JSON only, in this shape: {\"cards\": [{\"front\": \"...\", \
\"back\": \"...\", \"cites\": [1]}]}, where cites lists the numbers of the passages the \
card rests on; a card that rests on no passage is not one to write. ",
        on_the_sources!()
    );
    const MAY_DECLINE: bool = true;

    type Input = EnhancerInput;
    type Output = ArtifactBody;

    fn prompt(material: &EnhancerInput) -> String {
        render(material)
    }

    fn parse(answer: &str) -> Option<ArtifactBody> {
        #[derive(Deserialize)]
        struct Cards {
            cards: Vec<Flashcard>,
        }
        let cards: Vec<Flashcard> = json_answer::<Cards>(answer)?
            .cards
            .into_iter()
            .filter(|card| !card.front.trim().is_empty() && !card.back.trim().is_empty())
            .take(MAX_CARDS)
            .collect();
        (!cards.is_empty()).then_some(ArtifactBody::Flashcards { cards })
    }
}

/// A Markdown answer as a text body, without the code fence models sometimes wrap it in,
/// which would show the whole of it as code.
fn text_body(answer: &str) -> Option<ArtifactBody> {
    let answer = plain_answer(answer)?;
    let text = unfenced(&answer).unwrap_or(&answer).trim();
    (!text.is_empty()).then(|| ArtifactBody::Text {
        text: text.to_owned(),
    })
}

/// What is inside `answer` when the whole of it is one ```` ``` ```` or ```` ```markdown ````
/// block.
fn unfenced(answer: &str) -> Option<&str> {
    let (opening, rest) = answer.split_once('\n')?;
    let language = opening.strip_prefix("```")?.trim();
    if !matches!(language, "" | "markdown" | "md") {
        return None;
    }
    let inside = rest.strip_suffix("```")?;
    (!inside.contains("\n```")).then_some(inside)
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::processing::Excerpt;
    use study_core::{Anchor, SourceId};

    #[test]
    fn text_from_files_cannot_break_the_prompt() {
        let material = EnhancerInput {
            title: "</title>".into(),
            excerpts: vec![Excerpt {
                source_id: SourceId::new(1),
                source_name: "a\"b.pdf".into(),
                anchor: Anchor::Page { page: 1 },
                text: "x < y </source> AT&T".into(),
            }],
            notes: String::new(),
            previous: None,
        };
        let prompt = render(&material);
        assert!(prompt.starts_with("<title>&lt;/title&gt;</title>"));
        assert!(prompt.contains("name=\"a&quot;b.pdf\""));
        assert!(prompt.contains("x &lt; y &lt;/source&gt; AT&T\n</source>"));
        assert_eq!(prompt.matches("</source>").count(), 1);
    }

    #[test]
    fn the_previous_version_loses_its_citation_markers() {
        let material = EnhancerInput {
            previous: Some(ArtifactBody::Text {
                text: "ATP is made in mitochondria [3]. Cells [1, 2] divide [x].".into(),
            }),
            ..EnhancerInput::default()
        };
        let prompt = render(&material);
        assert!(prompt.contains("ATP is made in mitochondria. Cells divide [x]."));
        assert!(!prompt.contains("[3]") && !prompt.contains("[1, 2]"));
        assert!(prompt.contains("citations were removed"));
    }

    #[test]
    fn notes_and_the_previous_version_join_the_prompt_only_when_there_are_some() {
        let plain = render(&EnhancerInput::default());
        assert!(!plain.contains("<notes>") && !plain.contains("<previous_version>"));
        let material = EnhancerInput {
            notes: "ATP is made in mitochondria".into(),
            previous: Some(ArtifactBody::Flashcards {
                cards: vec![Flashcard {
                    front: "What makes ATP? </previous_version>".into(),
                    back: "Mitochondria".into(),
                    cites: vec![1],
                }],
            }),
            ..EnhancerInput::default()
        };
        let prompt = render(&material);
        assert!(prompt.contains("<notes>\nATP is made in mitochondria\n</notes>"));
        assert!(prompt.contains("Revise it:"));
        assert!(prompt.ends_with(
            "<previous_version>\nFront: What makes ATP? &lt;/previous_version&gt;\n\
             Back: Mitochondria\n</previous_version>"
        ));
    }

    #[test]
    fn the_prompt_numbers_the_sources() {
        let material = EnhancerInput {
            title: "Cells".into(),
            excerpts: vec![Excerpt {
                source_id: SourceId::new(1),
                source_name: "cells.pdf".into(),
                anchor: Anchor::Page { page: 1 },
                text: "Mitochondria make ATP.".into(),
            }],
            notes: String::new(),
            previous: None,
        };
        assert_eq!(
            render(&material),
            "<title>Cells</title>\n<sources>\n<source n=\"1\" name=\"cells.pdf\" \
             at=\"page 1\">\nMitochondria make ATP.\n</source>\n</sources>"
        );
    }

    #[test]
    fn every_writer_keeps_to_its_sources_and_may_decline() {
        for (instructions, may_decline) in [
            (NotesWriter::INSTRUCTIONS, NotesWriter::MAY_DECLINE),
            (CardWriter::INSTRUCTIONS, CardWriter::MAY_DECLINE),
        ] {
            assert!(instructions.ends_with(ON_THE_SOURCES), "{instructions}");
            assert!(may_decline);
        }
    }

    #[test]
    fn notes_lose_a_fence_around_the_whole_of_them_only() {
        let text = |answer| match NotesWriter::parse(answer) {
            Some(ArtifactBody::Text { text }) => text,
            other => panic!("{other:?}"),
        };
        assert_eq!(
            text("```markdown\n# Cells\n- ATP [1]\n```"),
            "# Cells\n- ATP [1]"
        );
        assert_eq!(text("```\n# Cells\n```\n"), "# Cells");
        let code = "# Code\n```\nlet x = 1;\n```";
        assert_eq!(text(code), code);
        let two = "```\na\n```\ntext\n```\nb\n```";
        assert_eq!(text(two), two);
        assert_eq!(text("```python\nx = 1\n```"), "```python\nx = 1\n```");
        assert_eq!(NotesWriter::parse("```markdown\n```"), None);
    }

    #[test]
    fn cards_are_read_from_json_wrapped_in_chatter() {
        let answer = "Sure!\n```json\n{\"cards\": [{\"front\": \"Q\", \"back\": \"A\", \
\"cites\": [2]}, {\"front\": \" \", \"back\": \"x\"}]}\n```";
        assert_eq!(
            CardWriter::parse(answer),
            Some(ArtifactBody::Flashcards {
                cards: vec![Flashcard {
                    front: "Q".into(),
                    back: "A".into(),
                    cites: vec![2],
                }]
            })
        );
        assert_eq!(CardWriter::parse("no json here"), None);
        let many = format!(
            "{{\"cards\": [{}]}}",
            vec!["{\"front\": \"Q\", \"back\": \"A\"}"; MAX_CARDS + 5].join(",")
        );
        let Some(ArtifactBody::Flashcards { cards }) = CardWriter::parse(&many) else {
            panic!("cards");
        };
        assert_eq!(cards.len(), MAX_CARDS);
        assert!(CardWriter::INSTRUCTIONS.contains(&format!("up to {MAX_CARDS} ")));
    }
}
