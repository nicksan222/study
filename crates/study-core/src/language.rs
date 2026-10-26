//! [`Language`]: the one language the user chose in Settings, which the interface speaks and
//! every agent writes in. It is stored in [`LanguagePreferences`], apart from the desktop's own
//! preferences, so the agents below the UI can read it.

crate::choice! {
    /// The language of the interface and of everything the models write for the student.
    pub enum Language {
        #[default]
        English = "en",
        Italian = "it",
    }
}

crate::preferences! {
    /// The language the user chose.
    #[preferences(scope = "language")]
    #[derive(Copy)]
    pub struct LanguagePreferences {
        pub language: Language = Language::English,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_language_is_saved() -> crate::Result<()> {
        let (_dir, database) = crate::db::Database::temporary()?;
        assert_eq!(
            LanguagePreferences::load(&database)?.language,
            Language::English
        );
        LanguagePreferences {
            language: Language::Italian,
        }
        .save(&database)?;
        assert_eq!(
            LanguagePreferences::load(&database)?.language,
            Language::Italian
        );
        Ok(())
    }
}
