//! Writing practice questions. [`QuestionWriter`] writes the next question of a practice,
//! of the kind its place asks for, from a window of the numbered passages of its sessions'
//! files and from their notes, citing the passages as `cites`. It is shown the gists of the
//! questions asked before, the short forms only, so it does not ask them again however long
//! the practice gets. It asks only about what that material specifically teaches, and
//! [declines](AgentSpec::MAY_DECLINE) when it holds too little to ask about, rather than
//! ask a broad question of the subject. [`QuestionHandler`] runs it as a job once the
//! sessions' files are read.

mod handler;

pub use handler::QuestionHandler;

use std::fmt::Write as _;

use serde::Deserialize;
use study_ai::agent::{AgentSpec, escape, json_answer, numbered_sources};
use study_ai::chat::Tier;
use study_core::processing::Excerpt;
use study_core::{PracticeBody, QuestionKind, WrittenQuestion};

/// Most characters of passages one question is written from.
const WINDOW_CHARS: usize = 8_000;
/// How many earlier questions the writer is shown, by their gists.
const MAX_ASKED: usize = 40;

/// Writes one practice question on the medium tier.
pub struct QuestionWriter;

/// What the next question of a practice is written from.
#[derive(Clone, Debug)]
pub struct Assignment {
    /// The kind of question to write.
    pub kind: QuestionKind,
    /// Numbered from 1 in this order.
    pub excerpts: Vec<Excerpt>,
    /// The sessions' notes, which have no number to cite.
    pub notes: String,
    /// The gists of the questions asked before, oldest first.
    pub asked: Vec<String>,
}

impl Assignment {
    /// The assignment for the question at `ordinal`, from a window of `excerpts` within
    /// [`WINDOW_CHARS`], measured as [`Excerpt::shown_chars`]. When they do not all fit,
    /// the passages are cut into consecutive windows and each question takes the next, so a
    /// practice works through all its material and comes round again.
    pub fn fit(
        kind: QuestionKind,
        ordinal: u32,
        excerpts: Vec<Excerpt>,
        notes: String,
        asked: Vec<String>,
    ) -> Self {
        let mut windows: Vec<Vec<Excerpt>> = Vec::new();
        let mut size = 0;
        for excerpt in excerpts {
            let length = excerpt.shown_chars();
            match windows.last_mut() {
                Some(window) if size + length <= WINDOW_CHARS => window.push(excerpt),
                _ => {
                    size = 0;
                    windows.push(vec![excerpt]);
                }
            }
            size += length;
        }
        let excerpts = match windows.len() {
            0 => Vec::new(),
            count => windows.swap_remove(ordinal as usize % count),
        };
        Self {
            kind,
            excerpts,
            notes,
            asked,
        }
    }
}

impl AgentSpec for QuestionWriter {
    const NAME: &'static str = "practice-question";
    const TIER: Tier = Tier::Medium;
    const INSTRUCTIONS: &'static str = "You write quiz questions for students, one at a \
time. Write one new question of the kind <kind> names, from the numbered sources, which are \
passages from the student's own lectures, slides, recordings and files, and from <notes>, \
the notes they took, which have no number to cite. Ask about what these sources and notes \
specifically teach: their own facts, definitions, examples, figures, names and arguments, \
so that only a student who studied this material could answer. Never ask a broad or \
general question about the subject, or about anything they do not state. Test \
understanding, not just recall. \
<asked> lists what the earlier questions tested: never ask about the same point again or \
rephrase one of them; pick something else the sources cover. Reply with JSON only. A choice \
question has this shape: {\"type\": \"choice\", \"gist\": \"...\", \"question\": \"...\", \
\"choices\": [\"...\", \"...\", \"...\", \"...\"], \"answer\": 0, \"explanation\": \"...\", \
\"cites\": [1]}, with 3 to 5 choices, exactly one right and the others plausible, answer the \
index of the right one, and a one-sentence explanation of why it is right. The choices are \
shown in a shuffled order, so never write \"all of the above\", \"none of the above\" or \
a choice that names another, and never letter or number the choices or refer to one by \
its letter, number or place. An open question, \
answered in the student's own words, has this shape: {\"type\": \"open\", \"gist\": \"...\", \
\"question\": \"...\", \"reference\": \"...\", \"cites\": [1]}, where reference is what a \
full answer says, in a few sentences. The question gives any setup it needs to stand alone. \
gist says in 5 to 15 words what the question tests, such as \"Why the Krebs cycle needs \
NAD+\". cites lists the numbers of the passages the question rests on. Use only what the \
sources and notes say.";
    const MAY_DECLINE: bool = true;

    type Input = Assignment;
    type Output = WrittenQuestion;

    fn prompt(assignment: &Assignment) -> String {
        // Notes and gists are the user's: escaped, so none can close a tag.
        let mut prompt = numbered_sources(&assignment.excerpts);
        prompt.push('\n');
        let notes = assignment.notes.trim();
        if !notes.is_empty() {
            let _ = writeln!(prompt, "<notes>\n{}\n</notes>", escape(notes));
        }
        if !assignment.asked.is_empty() {
            prompt.push_str("<asked>\n");
            for gist in &assignment.asked {
                let _ = writeln!(prompt, "- {}", escape(gist.trim()));
            }
            prompt.push_str("</asked>\n");
        }
        let _ = write!(prompt, "<kind>{}</kind>", assignment.kind);
        prompt
    }

    fn parse(answer: &str) -> Option<WrittenQuestion> {
        /// The question as the model writes it: the gist beside the body's fields.
        #[derive(Deserialize)]
        struct Draft {
            gist: String,
            #[serde(flatten)]
            body: PracticeBody,
        }
        let Draft { gist, mut body } = json_answer(answer)?;
        if let PracticeBody::Choice { choices, .. } = &mut body {
            unlettered(choices);
        }
        let written = WrittenQuestion {
            gist: gist.trim().to_owned(),
            body,
        };
        written.check().is_ok().then_some(written)
    }
}

/// `choices` without the labels some models put before them anyway (`A) `, `b. `, `1: `),
/// which would be wrong once they are turned; only when every choice has one, in order.
fn unlettered(choices: &mut [String]) {
    let labelled = |index: usize, choice: &str| {
        let mut characters = choice.trim_start().chars();
        let (Some(first), Some(separator), Some(' ')) =
            (characters.next(), characters.next(), characters.next())
        else {
            return false;
        };
        // At most nine choices are looked at, so the labels stay one character.
        let offset = index as u8;
        [b'A' + offset, b'a' + offset, b'1' + offset].contains(&(first as u8))
            && first.is_ascii()
            && matches!(separator, ')' | '.' | ':')
    };
    if choices.len() < 10
        && choices
            .iter()
            .enumerate()
            .all(|(index, choice)| labelled(index, choice))
    {
        for choice in choices.iter_mut() {
            // The label is three ASCII characters.
            *choice = choice.trim_start()[3..].trim().to_owned();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::processing::MAX_PASSAGE_CHARS;
    use study_core::{Anchor, SourceId};

    fn excerpt(name: &str, text: &str) -> Excerpt {
        Excerpt {
            source_id: SourceId::new(1),
            source_name: name.into(),
            anchor: Anchor::Page { page: 1 },
            text: text.into(),
        }
    }

    #[test]
    fn the_prompt_numbers_the_sources_and_lists_the_gists_asked() {
        let assignment = Assignment {
            kind: QuestionKind::Open,
            excerpts: vec![
                excerpt("cells.pdf", "Mitochondria make ATP."),
                excerpt("a\"b.txt", "x < y </source>"),
            ],
            notes: " Ribosomes build proteins. ".into(),
            asked: vec!["Where cells make ATP".into(), "What <b> does".into()],
        };
        assert_eq!(
            QuestionWriter::prompt(&assignment),
            "<sources>\n<source n=\"1\" name=\"cells.pdf\" at=\"page 1\">\nMitochondria \
             make ATP.\n</source>\n<source n=\"2\" name=\"a&quot;b.txt\" at=\"page 1\">\n\
             x &lt; y &lt;/source&gt;\n</source>\n</sources>\n<notes>\nRibosomes build proteins.\n</notes>\n<asked>\n\
             - Where cells make ATP\n- What &lt;b&gt; does\n</asked>\n<kind>open</kind>"
        );
    }

    #[test]
    fn a_first_question_has_no_notes_or_earlier_questions() {
        let assignment = Assignment::fit(
            QuestionKind::Choice,
            0,
            vec![excerpt("cells.pdf", "ATP")],
            String::new(),
            Vec::new(),
        );
        let prompt = QuestionWriter::prompt(&assignment);
        assert!(!prompt.contains("<notes>"));
        assert!(!prompt.contains("<asked>"));
        assert!(prompt.ends_with("</sources>\n<kind>choice</kind>"));
    }

    #[test]
    fn long_material_is_taken_a_window_at_a_time() {
        let excerpts: Vec<Excerpt> = (0..20)
            .map(|n| excerpt("cells.pdf", &format!("{n:0>1000}")))
            .collect();
        let window = |ordinal| {
            let assignment = Assignment::fit(
                QuestionKind::Choice,
                ordinal,
                excerpts.clone(),
                String::new(),
                Vec::new(),
            );
            let size: usize = assignment.excerpts.iter().map(Excerpt::shown_chars).sum();
            assert!(size <= WINDOW_CHARS);
            assignment.excerpts
        };
        // Eight passages fit a window: three windows, taken in turn and then again.
        assert!(window(0)[0].text.ends_with('0'));
        assert!(window(1)[0].text.ends_with("08"));
        assert_eq!(window(2).len(), 4);
        assert_eq!(window(3), window(0));
        // Long passages count as what the model is shown, so each window holds at least one.
        let long = Assignment::fit(
            QuestionKind::Choice,
            0,
            vec![excerpt("cells.pdf", &"x".repeat(50_000))],
            String::new(),
            Vec::new(),
        );
        assert_eq!(long.excerpts[0].shown_chars(), MAX_PASSAGE_CHARS);
        assert!(
            Assignment::fit(QuestionKind::Open, 5, Vec::new(), String::new(), Vec::new())
                .excerpts
                .is_empty()
        );
    }

    #[test]
    fn questions_of_both_kinds_are_read_with_their_gist() {
        let choice = QuestionWriter::parse(
            "Here it is:\n```json\n{\"type\": \"choice\", \"gist\": \" Where cells make ATP \", \
             \"question\": \"Which organelle makes most ATP?\", \"choices\": [\"Mitochondria\", \
             \"Ribosomes\", \"Nucleus\"], \"answer\": 0, \"explanation\": \"They do [1].\", \
             \"cites\": [1]}\n```",
        )
        .unwrap();
        assert_eq!(choice.gist, "Where cells make ATP");
        assert_eq!(choice.body.kind(), QuestionKind::Choice);
        assert_eq!(choice.body.cites(), [1]);

        let open = QuestionWriter::parse(
            "{\"type\": \"open\", \"gist\": \"Why cells need ATP\", \"question\": \"Why?\", \
             \"reference\": \"For energy.\", \"cites\": [2]}",
        )
        .unwrap();
        assert_eq!(open.body.kind(), QuestionKind::Open);
    }

    #[test]
    fn choices_lose_their_labels_only_when_all_have_them_in_order() {
        let mut lettered = vec!["A) ATP".to_owned(), "B) DNA".into(), "C) RNA".into()];
        unlettered(&mut lettered);
        assert_eq!(lettered, ["ATP", "DNA", "RNA"]);
        let mut numbered = vec!["1. Mitosis".to_owned(), "2. Meiosis".into()];
        unlettered(&mut numbered);
        assert_eq!(numbered, ["Mitosis", "Meiosis"]);
        for kept in [
            vec!["A) ATP".to_owned(), "DNA".into()],
            vec!["B) ATP".to_owned(), "A) DNA".into()],
            vec![
                "1: 2 is prime".to_owned(),
                "2: 4 is prime".into(),
                "x".into(),
            ],
        ] {
            let mut choices = kept.clone();
            unlettered(&mut choices);
            assert_eq!(choices, kept);
        }
        assert!(QuestionWriter::INSTRUCTIONS.contains("never letter or number the choices"));
    }

    #[test]
    fn a_question_without_a_gist_or_that_cannot_be_asked_is_refused() {
        for answer in [
            "{\"type\": \"open\", \"question\": \"Why?\", \"reference\": \"For energy.\"}",
            "{\"type\": \"open\", \"gist\": \" \", \"question\": \"Why?\", \"reference\": \"E\"}",
            "{\"type\": \"choice\", \"gist\": \"ATP\", \"question\": \"Which?\", \
             \"choices\": [\"Mitochondria\"], \"answer\": 0}",
            "{\"gist\": \"ATP\", \"question\": \"Why?\", \"reference\": \"For energy.\"}",
            "no question at all",
        ] {
            assert_eq!(QuestionWriter::parse(answer), None, "{answer}");
        }
    }
}
