//! Cutting text down to size for titles, previews and prompts.

/// The first `max_chars` characters of `text`, never splitting a character.
pub fn truncate_chars(text: &str, max_chars: usize) -> &str {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => &text[..end],
        None => text,
    }
}

/// At most `max_chars` characters of `text`, ending at a word boundary when one is in the
/// second half of the cut.
pub fn truncate_words(text: &str, max_chars: usize) -> &str {
    let cut = truncate_chars(text, max_chars);
    if cut.len() == text.len() {
        return text;
    }
    match cut.rfind(' ') {
        Some(space) if space >= max_chars / 2 => cut[..space].trim_end(),
        _ => cut,
    }
}

/// `text` on one line with single spaces, then shortened to at most `max_chars` characters
/// with an ellipsis, preferring a word boundary. `None` when nothing is left.
pub fn title_from(text: &str, max_chars: usize) -> Option<String> {
    let collapsed = collapse_whitespace(text);
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() <= max_chars {
        return Some(collapsed);
    }
    let cut = truncate_words(&collapsed, max_chars.saturating_sub(1));
    Some(format!("{}…", cut.trim_end()))
}

/// `text` on one line: every run of whitespace becomes a single space, and the ends are
/// trimmed.
pub fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn characters_are_never_split() {
        assert_eq!(truncate_chars("perché no", 6), "perché");
        assert_eq!(truncate_chars("short", 10), "short");
    }

    #[test]
    fn words_are_kept_whole_when_a_break_is_close() {
        assert_eq!(truncate_words("the quick brown fox", 12), "the quick");
        assert_eq!(truncate_words("supercalifragilistic", 8), "supercal");
        assert_eq!(truncate_words("fits", 10), "fits");
    }

    #[test]
    fn titles_collapse_whitespace_and_end_with_an_ellipsis() {
        assert_eq!(
            title_from("  Cell\n division  ", 60).as_deref(),
            Some("Cell division")
        );
        assert_eq!(
            title_from("one two three four", 10).as_deref(),
            Some("one two…")
        );
        assert_eq!(title_from(" \n ", 10), None);
    }
}
