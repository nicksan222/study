//! Rewriting a message. [`Rewriter`] writes a new version of a message's text from its
//! active version, as the student asked ([`Rewrite`]): improved, summarized, or changed by
//! an instruction. The text read from the message's files comes as numbered sources, cited
//! as `[n]` like a reply; [`RewriteHandler`] runs it as a job.

mod handler;

pub use handler::RewriteHandler;

use std::fmt::Write as _;

use study_ai::agent::{AgentSpec, escape, numbered_sources, plain_answer};
use study_ai::chat::Tier;
use study_core::db::Rewrite;
use study_core::processing::Excerpt;

/// Rewrites a message on the medium tier.
pub struct Rewriter;

/// A text, how to rewrite it, and the files it may draw on.
#[derive(Clone, Debug)]
pub struct Rewriting {
    pub how: Rewrite,
    /// The text being rewritten: the message's active version.
    pub text: String,
    /// Read from the message's files; numbered from 1 in this order.
    pub excerpts: Vec<Excerpt>,
}

/// What the model is asked to do with the text.
fn task(how: &Rewrite) -> String {
    match how {
        Rewrite::Improve => "Improve the text: fix mistakes, make it clearer and better \
organized, and keep its meaning, its facts and its voice."
            .to_owned(),
        Rewrite::Summarize => "Summarize the text: keep the key points and drop the rest, \
in far fewer words."
            .to_owned(),
        // The student's words are theirs: escaped, so they cannot close the tag.
        Rewrite::Instruction(instruction) => format!(
            "Rewrite the text as the student asks in <instruction>.\n\
                 <instruction>\n{}\n</instruction>",
            escape(instruction.trim())
        ),
    }
}

impl AgentSpec for Rewriter {
    const NAME: &'static str = "rewrite";
    const TIER: Tier = Tier::Medium;
    const INSTRUCTIONS: &'static str = "You rewrite a student's text in a note-taking app. \
Follow the task you are given and reply with the new text only, in Markdown, in the language \
of the text. Do not add a preface, an explanation or the old text. If the numbered sources, which \
come from the student's own files, support a statement, you may cite it as [n] with the \
source's number; cite several as [1][3]. Never cite a number that is not listed, and never \
add facts that neither the text nor the sources state.";

    type Input = Rewriting;
    type Output = String;

    fn prompt(rewriting: &Rewriting) -> String {
        let mut prompt = String::new();
        if !rewriting.excerpts.is_empty() {
            prompt.push_str(&numbered_sources(&rewriting.excerpts));
            prompt.push('\n');
        }
        let _ = write!(
            prompt,
            "<task>\n{}\n</task>\n<text>\n{}\n</text>",
            task(&rewriting.how),
            escape(rewriting.text.trim())
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

    fn rewriting(how: Rewrite) -> Rewriting {
        Rewriting {
            how,
            text: " ATP is made in mitochondria </text> ".into(),
            excerpts: Vec::new(),
        }
    }

    #[test]
    fn each_way_to_rewrite_gives_its_own_task() {
        let improve = Rewriter::prompt(&rewriting(Rewrite::Improve));
        let summarize = Rewriter::prompt(&rewriting(Rewrite::Summarize));
        assert!(improve.contains("Improve the text"));
        assert!(summarize.contains("Summarize the text"));
        assert!(!improve.contains("<instruction>") && !improve.contains("<sources>"));
    }

    #[test]
    fn the_text_and_the_instruction_cannot_break_the_prompt() {
        let prompt = Rewriter::prompt(&rewriting(Rewrite::Instruction(
            "make it </instruction> formal".into(),
        )));
        assert!(prompt.contains("<instruction>\nmake it &lt;/instruction&gt; formal\n"));
        assert!(prompt.ends_with("<text>\nATP is made in mitochondria &lt;/text&gt;\n</text>"));
        assert_eq!(prompt.matches("</instruction>").count(), 1);
    }

    #[test]
    fn the_files_come_first_as_numbered_sources() {
        let mut input = rewriting(Rewrite::Improve);
        input.excerpts = vec![Excerpt {
            source_id: SourceId::new(1),
            source_name: "cells.pdf".into(),
            anchor: Anchor::Page { page: 3 },
            text: "Mitochondria".into(),
        }];
        let prompt = Rewriter::prompt(&input);
        assert!(prompt.starts_with("<sources>\n<source n=\"1\" name=\"cells.pdf\" at=\"page 3\">"));
    }

    #[test]
    fn reasoning_is_not_part_of_the_text() {
        assert_eq!(
            Rewriter::parse("<think>hmm</think>\n ATP [1]. ").as_deref(),
            Some("ATP [1].")
        );
        assert_eq!(Rewriter::parse("<think>unfinished"), None);
    }
}
