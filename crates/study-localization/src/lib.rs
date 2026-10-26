//! User-facing copy and value formatting for Study, in English and Italian.
//!
//! | Where | What |
//! |---|---|
//! | [`Locale`] | the language the interface speaks: `study_core::Language`, under the name this crate uses |
//! | `message` | [`Message`]: the identity of every piece of fixed copy, grouped by screen |
//! | `catalog/` | [`text`] and one exhaustive catalog file per locale, in the same order as `message` |
//! | `format/` | copy built around a value: counts, quantities, time, joined text, source anchors, mentions |
//!
//! **Finding copy.** Search `message.rs` for the section of the screen (each section is a
//! `// Screen: part` comment), then open the same section in `catalog/english.rs` or
//! `catalog/italian.rs`. A test keeps the three files in the same order.
//!
//! **Adding copy.** Add a [`Message`] variant to the right section and the same arm, at the
//! same position, in every catalog. Copy with a number, unit or list is a formatter instead.
//!
//! **Adding a language.** Add a `study_core::Language` variant, add a
//! catalog file, then follow the compile errors: every `match` on a locale is exhaustive.

mod catalog;
mod format;
mod message;

pub use catalog::text;
pub use format::*;
pub use message::Message;
/// The language the interface speaks, which is the language the user chose: one type for
/// the app, its copy and its agents.
pub use study_core::Language as Locale;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn italian_catalog_names_navigation_and_an_empty_state() {
        assert_eq!(text(Locale::Italian, Message::Home), "Home");
        assert_eq!(text(Locale::Italian, Message::MediaList), "Libreria");
        assert_eq!(text(Locale::Italian, Message::Projects), "Progetti");
        assert_eq!(text(Locale::Italian, Message::Settings), "Impostazioni");
        assert_eq!(text(Locale::Italian, Message::Help), "Aiuto");
        assert_eq!(
            text(Locale::Italian, Message::NoMediaYet),
            "Ancora nessun file. Aggiungine uno per iniziare."
        );
    }

    /// The composer teaches the one way to ask the assistant.
    #[test]
    fn the_composer_names_the_assistant_mention() {
        for &locale in Locale::ALL {
            let hint = text(locale, Message::ComposerPlaceholder);
            assert!(hint.contains(study_core::ASSISTANT_MENTION), "{hint}");
        }
    }
}
