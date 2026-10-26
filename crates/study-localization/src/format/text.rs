//! Copy built around text values: lists, breadcrumbs, quiz choices, titles and file names.

use crate::{Locale, Message, text};

/// The mark between values side by side on one line, for a line built of separate pieces
/// (such as links or a coloured figure) that [`joined`] can't make as one string.
pub fn separator() -> &'static str {
    "·"
}

/// Values shown side by side on one line, such as a type and a size. Empty values are
/// left out, so a missing one leaves no dangling separator.
pub fn joined(parts: &[String]) -> String {
    let parts: Vec<&str> = parts
        .iter()
        .map(String::as_str)
        .filter(|part| !part.trim().is_empty())
        .collect();
    parts.join(&format!(" {} ", separator()))
}

/// A figure before the words that say what it counts, such as `17 reviews this week`.
pub fn counted(count: impl std::fmt::Display, what: &str) -> String {
    format!("{count} {what}")
}

/// Short names listed inline, such as `avx2, fma, neon`.
pub fn listed(items: &[String]) -> String {
    items.join(", ")
}

/// Where something sits, from the outside in, such as a project and a session.
pub fn breadcrumb(outer: &str, inner: &str) -> String {
    format!("{outer} › {inner}")
}

/// The letter a quiz choice goes by: `A` for the first, then `B`, and so on.
pub fn choice_letter(index: u32) -> char {
    char::from(b'A' + (index % 26) as u8)
}

/// A quiz choice as accessibility reads it: its letter and what it says, as
/// `B. Ribosomes`.
pub fn choice_label(index: u32, choice: &str) -> String {
    format!("{}. {choice}", choice_letter(index))
}

/// An operating system and, when known, its version, such as `Linux 6.9`.
pub fn operating_system(name: &str, version: Option<&str>) -> String {
    match version {
        Some(version) => format!("{name} {version}"),
        None => name.to_owned(),
    }
}

/// The title of the flashcard set a practice's mistakes go into: `Mistakes: Cells`.
pub fn mistakes_title(locale: Locale, practice: &str) -> String {
    match locale {
        Locale::English => format!("Mistakes: {practice}"),
        Locale::Italian => format!("Errori: {practice}"),
    }
}

/// The file name material titled `title` is saved as with `extension`, such as
/// `Mitosis.svg`, without control characters or the characters file systems refuse;
/// `Untitled.svg` when that leaves no name, or only dots.
pub fn material_file_name(locale: Locale, title: &str, extension: &str) -> String {
    let safe: String = title
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let name = match safe.trim() {
        // No name at all, or dots alone, which name a folder or its parent, not a file.
        name if name.chars().all(|c| c == '.') => text(locale, Message::UntitledMaterial),
        name => name,
    };
    format!("{name}.{extension}")
}

/// The choice that keeps a tier on the model recommended for it, named.
pub fn recommended_model(locale: Locale, model: &str) -> String {
    match locale {
        Locale::English => format!("Recommended ({model})"),
        Locale::Italian => format!("Consigliato ({model})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joined_values_leave_out_empty_ones() {
        let parts = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
        assert_eq!(joined(&parts(&["Question 1", "Gist"])), "Question 1 · Gist");
        assert_eq!(joined(&parts(&["Question 1", ""])), "Question 1");
        assert_eq!(joined(&parts(&["", " ", "PDF"])), "PDF");
        assert_eq!(joined(&[]), "");
    }

    #[test]
    fn a_choice_reads_as_its_letter_and_words() {
        assert_eq!(choice_letter(0), 'A');
        assert_eq!(choice_letter(3), 'D');
        assert_eq!(choice_label(1, "Ribosomes"), "B. Ribosomes");
    }

    #[test]
    fn a_diagram_is_saved_under_its_title_without_unsafe_characters() {
        let name = |title| material_file_name(Locale::English, title, "svg");
        assert_eq!(name("Mitosis"), "Mitosis.svg");
        assert_eq!(name("Cells / ATP: why?"), "Cells   ATP  why.svg");
        // Control characters go; the spaces around them stay.
        assert_eq!(name("Cell\ncycle\t \u{7}phases"), "Cellcycle phases.svg");
    }

    #[test]
    fn a_title_that_leaves_no_name_is_saved_as_untitled() {
        for title in ["", "  ", "/:?", "\n\t\u{0}", ".", "..", " ... "] {
            assert_eq!(
                material_file_name(Locale::English, title, "svg"),
                "Untitled.svg"
            );
        }
        assert_eq!(
            material_file_name(Locale::Italian, "*", "md"),
            "Senza titolo.md"
        );
    }
}
