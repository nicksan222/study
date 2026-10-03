//! Study sessions: the small rules the session screen follows.

use std::path::PathBuf;

use study_app::views::{ChatMessage, PartContent};

/// Longest provisional title derived from a first message, shown until the title agent
/// names the session.
const MAX_DERIVED_TITLE_CHARS: usize = 60;

/// A session's provisional title from its first message: the first line of text, else the
/// first file.
pub fn derive_title(text: &str, files: &[PathBuf]) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty());
    let source = match line {
        Some(line) => line.to_owned(),
        None => files
            .first()?
            .file_name()?
            .to_string_lossy()
            .trim()
            .to_owned(),
    };
    study_core::text::title_from(&source, MAX_DERIVED_TITLE_CHARS)
}

/// What a message says, to copy: its words, a blank line between parts as in the
/// transcript. Empty when it holds only files or study material.
pub fn message_words(message: &ChatMessage) -> String {
    let words: Vec<&str> = message
        .parts
        .iter()
        .filter_map(|part| match &part.content {
            PartContent::Text(body) => Some(body.as_str()),
            _ => None,
        })
        .collect();
    words.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_come_from_the_first_line_of_text_or_the_first_file() {
        assert_eq!(
            derive_title("\n  Photosynthesis   recap \nmore", &[]).as_deref(),
            Some("Photosynthesis recap")
        );
        assert_eq!(
            derive_title("  ", &[PathBuf::from("/tmp/lecture 3.mp3")]).as_deref(),
            Some("lecture 3.mp3")
        );
        assert_eq!(derive_title("", &[]), None);
    }

    #[test]
    fn long_titles_are_shortened_on_a_word_boundary() {
        let title = derive_title(&"word ".repeat(40), &[]).unwrap();
        assert!(title.chars().count() <= MAX_DERIVED_TITLE_CHARS);
        assert!(title.ends_with("word…"));
        let unbroken = derive_title(&"x".repeat(200), &[]).unwrap();
        assert_eq!(unbroken.chars().count(), MAX_DERIVED_TITLE_CHARS);
    }
}
