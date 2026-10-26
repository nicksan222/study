//! Answering questions. A session is a log of notes, so the assistant answers only a note
//! that mentions it ([`study_core::Mention::Assistant`]). [`Answer`] writes that reply from
//! the passages of the student's own material, every file of the session first, citing them
//! as `[n]`; [`ReplyHandler`] runs it as a job once the note's files are read.

mod handler;

pub use handler::ReplyHandler;

use std::fmt::Write as _;

use study_ai::agent::{AgentSpec, escape, numbered_sources, plain_answer};
use study_ai::chat::Tier;
use study_core::processing::Excerpt;

use super::{Budget, Conversation};

/// What the model reads of the session before the question. The files' text comes as
/// numbered sources, so the conversation names them without repeating it.
const BUDGET: Budget = Budget {
    total: 8_000,
    per_message: 2_000,
    per_attachment: 0,
    attachments_per_message: 8,
};

/// Answers a question on the medium tier.
pub struct Answer;

/// A question and what it may be answered from.
#[derive(Clone, Debug, Default)]
pub struct Question {
    /// The messages before the question.
    pub earlier: Conversation,
    /// The question, without the mention that asked for an answer.
    pub text: String,
    /// Numbered from 1 in this order.
    pub excerpts: Vec<Excerpt>,
}

impl AgentSpec for Answer {
    const NAME: &'static str = "answer";
    const TIER: Tier = Tier::Medium;
    const INSTRUCTIONS: &'static str = "You are the study assistant in a note-taking app for \
students. The session is the student's own notes; they asked you something by name. Answer \
the student's question using the numbered sources, which come from their own lectures, \
slides, recordings and notes. After each statement taken from a source, cite it as [n], \
using the source's number; cite several as [1][3]. Never cite a number that is not listed. If \
the sources do not cover the question, say so in one short sentence, then answer from general \
knowledge without citations. Be clear and concise: short paragraphs, and a list only when it \
helps.";

    type Input = Question;
    type Output = String;

    fn prompt(question: &Question) -> String {
        let mut prompt = String::new();
        if !question.earlier.is_empty() {
            prompt.push_str("<conversation>\n");
            prompt.push_str(&question.earlier.render(BUDGET));
            prompt.push_str("</conversation>\n");
        }
        prompt.push_str(&numbered_sources(&question.excerpts));
        prompt.push('\n');
        let _ = write!(
            prompt,
            "<question>\n{}\n</question>",
            escape(question.text.trim())
        );
        prompt
    }

    fn parse(answer: &str) -> Option<String> {
        plain_answer(answer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::{Anchor, SourceId};

    #[test]
    fn the_prompt_numbers_every_source_with_its_place() {
        let question = Question {
            earlier: Conversation::default(),
            text: " What powers the cell? ".into(),
            excerpts: vec![
                Excerpt {
                    source_id: SourceId::new(1),
                    source_name: "cells.pdf".into(),
                    anchor: Anchor::Page { page: 3 },
                    text: "Mitochondria".into(),
                },
                Excerpt {
                    source_id: SourceId::new(2),
                    source_name: "lecture.mp3".into(),
                    anchor: Anchor::Time {
                        start_ms: 65_000,
                        end_ms: 125_000,
                    },
                    text: "ATP".into(),
                },
            ],
        };
        let prompt = Answer::prompt(&question);
        assert!(!prompt.contains("<conversation>"));
        assert!(
            prompt.contains("<source n=\"1\" name=\"cells.pdf\" at=\"page 3\">\nMitochondria\n")
        );
        assert!(prompt.contains("<source n=\"2\" name=\"lecture.mp3\" at=\"1:05-2:05\">"));
        assert!(prompt.ends_with("<question>\nWhat powers the cell?\n</question>"));
    }

    #[test]
    fn reasoning_is_not_part_of_the_answer() {
        assert_eq!(
            Answer::parse("<think>hmm</think>\n Mitochondria [1]. ").as_deref(),
            Some("Mitochondria [1].")
        );
        assert_eq!(Answer::parse("<think>unfinished"), None);
    }
}
