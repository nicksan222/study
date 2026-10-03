//! Naming sessions. [`SessionTitle`] turns a session's notes into a short title;
//! [`TitleHandler`] runs it as a job once a session's first files are read, and again
//! whenever the user asks for a new title.

mod handler;

pub use handler::TitleHandler;

use study_ai::agent::{AgentSpec, strip_reasoning};
use study_ai::chat::Tier;
use study_core::text::{collapse_whitespace, truncate_words};

use super::{Budget, Conversation};

/// Longest title kept; the instructions ask for far less.
const MAX_TITLE_CHARS: usize = 60;
/// What the model reads. The opening is what a title comes from, and a tiny model's context
/// is small.
const BUDGET: Budget = Budget {
    total: 6_000,
    per_message: 1_500,
    per_attachment: 800,
    attachments_per_message: 4,
};

/// Names a study session from its notes, on the tiny tier.
pub struct SessionTitle;

impl AgentSpec for SessionTitle {
    const NAME: &'static str = "session-title";
    const TIER: Tier = Tier::Tiny;
    const INSTRUCTIONS: &'static str = "You name study sessions in a note-taking app for \
students. Given the student's notes so far, including what was read from attached files, reply \
with a title of 2 to 6 words naming the subject being studied, the way a student would label \
a notebook page. Use sentence case. No quotes, \
no ending punctuation, no emoji, no words like \"Session\", \"Chat\", or \"Help with\". \
Reply with the title only.";

    type Input = Conversation;
    type Output = String;

    fn prompt(conversation: &Conversation) -> String {
        conversation.render(BUDGET)
    }

    fn parse(answer: &str) -> Option<String> {
        clean_title(answer)
    }
}

/// The title in a model's answer, without the wrapping small models add anyway: reasoning
/// blocks, a "Title:" label, Markdown, quotes, and a closing period.
fn clean_title(answer: &str) -> Option<String> {
    let answer = strip_reasoning(answer);
    let line = answer
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let line = line.trim_start_matches(['#', '*', '_', '`', '-', '>', ' ']);
    let line = strip_label(line);
    let line = line
        .trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\'' | '“' | '”' | '‘' | '’' | '«' | '»' | '*' | '_' | '`'
            ) || c.is_whitespace()
        })
        .trim_end_matches(['.', ':', ';', ',', '。']);
    let title = collapse_whitespace(line);
    if title.is_empty() {
        return None;
    }
    Some(truncate_words(&title, MAX_TITLE_CHARS).to_owned())
}

/// `line` without a leading "Title:" label, in English or Italian.
fn strip_label(line: &str) -> &str {
    for label in ["title:", "titolo:"] {
        if line
            .get(..label.len())
            .is_some_and(|start| start.eq_ignore_ascii_case(label))
        {
            return line[label.len()..].trim_start_matches(['*', ' ']);
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_lose_the_wrapping_small_models_add() {
        assert_eq!(
            clean_title("\"Photosynthesis basics.\"").as_deref(),
            Some("Photosynthesis basics")
        );
        assert_eq!(
            clean_title("**Title:** Cell   division\n\nExplanation…").as_deref(),
            Some("Cell division")
        );
        assert_eq!(
            clean_title("# «La Rivoluzione francese»").as_deref(),
            Some("La Rivoluzione francese")
        );
        assert_eq!(
            clean_title("<think>The user asks about\nderivatives</think>\nDerivatives of powers")
                .as_deref(),
            Some("Derivatives of powers")
        );
        assert_eq!(
            clean_title("Why is the sky blue?").as_deref(),
            Some("Why is the sky blue?")
        );
    }

    #[test]
    fn empty_or_unfinished_answers_have_no_title() {
        assert_eq!(clean_title(""), None);
        assert_eq!(clean_title(" \n\"\" "), None);
        assert_eq!(clean_title("<think>still thinking"), None);
    }

    #[test]
    fn long_titles_end_on_a_word() {
        let title = clean_title(&"word ".repeat(30)).unwrap();
        assert!(title.chars().count() <= MAX_TITLE_CHARS);
        assert!(title.ends_with("word"));
    }
}
