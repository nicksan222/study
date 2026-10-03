//! Asking the assistant. A session is a log of the student's notes, and nothing answers a
//! note by default: the assistant replies only to a note that mentions it by
//! [`ASSISTANT_MENTION`], the way a chat app pings someone. Study material and quizzes belong
//! to the project, not to a note, so no other word in a note asks for anything.
//!
//! [`mentions`] finds the mention, with where it is, so the composer and the transcript can
//! show it as a chip; the rest of this module answers what a note asks for.

use std::ops::Range;

/// What a note says to ask the assistant: [`ASSISTANT_PREFIX`] and its name. Matched
/// without regard to case.
pub const ASSISTANT_MENTION: &str = "@study";

/// What starts [`ASSISTANT_MENTION`], as a chat app's `@` starts a handle.
pub const ASSISTANT_PREFIX: char = '@';

/// Something a note asks for by name.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Mention {
    /// An answer, from [`ASSISTANT_MENTION`].
    Assistant,
}

impl Mention {
    /// The mention a word stands for, from its sigil ([`ASSISTANT_PREFIX`]) and the name
    /// after it, as notes store it; case does not matter.
    pub fn named(sigil: char, name: &str) -> Option<Self> {
        match sigil {
            ASSISTANT_PREFIX
                if ASSISTANT_MENTION
                    .strip_prefix(ASSISTANT_PREFIX)
                    .is_some_and(|assistant| name.eq_ignore_ascii_case(assistant)) =>
            {
                Some(Self::Assistant)
            }
            _ => None,
        }
    }

    /// How the mention is written in a note: [`ASSISTANT_MENTION`].
    pub fn written(self) -> String {
        match self {
            Self::Assistant => ASSISTANT_MENTION.to_owned(),
        }
    }
}

/// Every mention in `text`, with its byte range, in order. A mention is a word of its own,
/// so an address such as `me@study.edu`, a handle such as `@studybuddy` or a path such as
/// `notes/quiz` does not count.
pub fn mentions(text: &str) -> Vec<(Range<usize>, Mention)> {
    mentions_named(text, Mention::named)
}

/// Every word of `text` that `named` reads as a mention, from its sigil (`@`) and the name
/// after it, with its byte range, in order; words are found as
/// [`mentions`] finds them. For names in another language, as the composer reads them.
pub fn mentions_named(
    text: &str,
    named: impl Fn(char, &str) -> Option<Mention>,
) -> Vec<(Range<usize>, Mention)> {
    let word = |c: char| c.is_alphanumeric() || c == '_' || c == '-';
    let mut found = Vec::new();
    for (start, sigil) in text.char_indices() {
        if sigil != ASSISTANT_PREFIX {
            continue;
        }
        // A mention may follow punctuation, as in `(@study`, but not a word, as in an address.
        let before = text[..start].chars().next_back();
        if before.is_some_and(word) {
            continue;
        }
        let name_start = start + sigil.len_utf8();
        let name_len = text[name_start..]
            .find(|c: char| !word(c))
            .unwrap_or(text.len() - name_start);
        let end = name_start + name_len;
        let Some(mention) = named(sigil, &text[name_start..end]) else {
            continue;
        };
        let mut after = text[end..].chars();
        let next = after.next();
        // A dot ends a sentence, unless a word follows it at once, as in a domain name; a
        // slash goes on into a path.
        let dotted = next == Some('.') && after.next().is_some_and(word);
        if dotted || next == Some('/') {
            continue;
        }
        found.push((start..end, mention));
    }
    found
}

/// `text` with every mention taken out, for a model to read the request alone.
pub fn without_mention(text: &str) -> String {
    let (kept, _) = rewrite_mentions(text, &mentions(text), |_| String::new());
    crate::text::collapse_whitespace(&kept)
}

/// `text` with each of the mentions `found` in it replaced by what `write` makes of it, and
/// where each replacement ended up in the result, in order.
pub fn rewrite_mentions(
    text: &str,
    found: &[(Range<usize>, Mention)],
    write: impl Fn(Mention) -> String,
) -> (String, Vec<Range<usize>>) {
    let mut rewritten = String::with_capacity(text.len());
    let mut places = Vec::with_capacity(found.len());
    let mut last = 0;
    for (range, mention) in found {
        rewritten.push_str(&text[last..range.start]);
        let start = rewritten.len();
        rewritten.push_str(&write(*mention));
        places.push(start..rewritten.len());
        last = range.end;
    }
    rewritten.push_str(&text[last..]);
    (rewritten, places)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mentions_assistant(text: &str) -> bool {
        mentions(text)
            .iter()
            .any(|(_, mention)| *mention == Mention::Assistant)
    }

    #[test]
    fn only_a_mention_of_its_own_asks_the_assistant() {
        for text in [
            "@study what powers the cell?",
            "What powers the cell? @Study",
            "hey @STUDY, explain this.",
            "(@study) and then",
            "Ask @study.",
        ] {
            assert!(mentions_assistant(text), "{text:?}");
        }
        for text in [
            "Mitochondria power the cell.",
            "write to me@study.edu",
            "see @study.org",
            "ping @studybuddy",
            "study hard",
            "@study/notes",
        ] {
            assert!(!mentions_assistant(text), "{text:?}");
        }
    }

    #[test]
    fn a_slash_word_is_a_plain_note() {
        for text in ["/diagram the Krebs cycle", "a /Quiz please", "/notes"] {
            assert_eq!(mentions(text), vec![], "{text:?}");
        }
    }

    #[test]
    fn mentions_are_found_where_they_are_written() {
        let text = "ask @study this";
        assert_eq!(mentions(text), vec![(4..10, Mention::Assistant)]);
        for (range, mention) in mentions(text) {
            assert!(text[range].eq_ignore_ascii_case(&mention.written()));
        }
    }

    #[test]
    fn the_request_is_read_without_its_mentions() {
        assert_eq!(
            without_mention("@study  what powers the cell?"),
            "what powers the cell?"
        );
        assert_eq!(without_mention("Explain this, @Study"), "Explain this,");
        assert_eq!(without_mention("mail me@study.edu"), "mail me@study.edu");
        assert_eq!(
            without_mention("/diagram the cycle above"),
            "/diagram the cycle above"
        );
    }
}
