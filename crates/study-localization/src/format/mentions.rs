//! Mentions in session notes as the student types them: the assistant as `@study`. A mention
//! reads the same in every language, so notes are stored as typed.

use std::ops::Range;

use study_core::{ASSISTANT_PREFIX, Mention};

/// How a mention reads: `@study`.
pub fn mention_label(mention: Mention) -> String {
    mention.written()
}

/// The mention being typed at `cursor` in `text`, and every mention it could still become:
/// its range, from the `@` to the cursor, and the matches. A word matches by the start of its
/// name, whatever the case. `None` when the cursor is not at the end of a word that starts
/// with `@`, or nothing matches it.
pub fn mention_suggestions(text: &str, cursor: usize) -> Option<(Range<usize>, Vec<Mention>)> {
    let before = text.get(..cursor)?;
    if text[cursor..]
        .chars()
        .next()
        .is_some_and(|next| !next.is_whitespace())
    {
        return None;
    }
    let start = before
        .char_indices()
        .rev()
        .find(|(_, c)| c.is_whitespace())
        .map_or(0, |(index, c)| index + c.len_utf8());
    let word = &before[start..];
    let sigil = word.chars().next()?;
    if sigil != ASSISTANT_PREFIX {
        return None;
    }
    let typed = word[sigil.len_utf8()..].to_lowercase();
    let matches: Vec<Mention> = std::iter::once(Mention::Assistant)
        .filter(|mention| {
            mention.written()[sigil.len_utf8()..]
                .to_lowercase()
                .starts_with(&typed)
        })
        .collect();
    (!matches.is_empty()).then_some((start..cursor, matches))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_being_typed_offers_the_mentions_it_could_become() {
        let offered = |text: &str| mention_suggestions(text, text.len());
        assert_eq!(offered("hey @"), Some((4..5, vec![Mention::Assistant])));
        assert_eq!(
            offered("@ST").map(|(_, found)| found),
            Some(vec![Mention::Assistant])
        );
        assert_eq!(offered("see notes@st"), None);
        assert_eq!(offered("@zzz"), None);
        assert_eq!(offered("@s "), None);
        // Only at the end of the word.
        assert_eq!(mention_suggestions("@study", 2), None);
    }

    /// The match has no wildcard, so a new kind of mention fails to compile here until it
    /// is checked for, and then fails until the menu offers it.
    #[test]
    fn the_menu_offers_every_mention() {
        let mut assistant = false;
        for mention in mention_suggestions("@", 1).unwrap().1 {
            match mention {
                Mention::Assistant => assistant = true,
            }
        }
        assert!(assistant);
    }
}
