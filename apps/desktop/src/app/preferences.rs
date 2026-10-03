//! What the whole app remembers: the interface language, the look, the zoom, and whether
//! the welcome tour was seen. Each feature keeps its own preferences in its crate; these
//! belong to no single feature. The language is stored apart, in
//! [`LanguagePreferences`], because every agent writes in it too.

use study_app::App;
use study_core::{Language, LanguagePreferences, Result};

study_app::choice! {
    /// Light or dark window.
    pub enum Appearance {
        Light = "light",
        #[default]
        Dark = "dark",
    }
}

study_app::preferences! {
    /// Everything but the language: how the window looks and whether the tour was seen.
    #[preferences(scope = "app")]
    #[derive(Copy)]
    struct AppPreferences {
        appearance: Appearance = Appearance::Dark,
        /// One of the steps the View menu zooms through.
        zoom_percent: u16 = 100,
        /// The welcome tour was finished or skipped, so it does not open by itself again.
        onboarded: bool = false,
    }
}

/// What the whole app remembers, as the shell works with it.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Preferences {
    pub language: Language,
    pub appearance: Appearance,
    /// One of the steps the View menu zooms through.
    pub zoom_percent: u16,
    /// The welcome tour was finished or skipped, so it does not open by itself again.
    pub onboarded: bool,
}

impl Preferences {
    /// The saved preferences, with defaults for anything never saved.
    pub fn load(app: &App) -> Result<Self> {
        let window: AppPreferences = app.preferences()?;
        let language: LanguagePreferences = app.preferences()?;
        Ok(Self {
            language: language.language,
            appearance: window.appearance,
            zoom_percent: window.zoom_percent,
            onboarded: window.onboarded,
        })
    }

    /// Saves them: the language where every agent reads it, the rest under the app's scope.
    pub fn save(&self, app: &App) -> Result<()> {
        app.save_preferences(&LanguagePreferences {
            language: self.language,
        })?;
        app.save_preferences(&AppPreferences {
            appearance: self.appearance,
            zoom_percent: self.zoom_percent,
            onboarded: self.onboarded,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TempApp;

    #[test]
    fn a_new_install_is_english_dark_and_unzoomed() -> Result<()> {
        let app = TempApp::new();
        let preferences = Preferences::load(&app)?;
        assert_eq!(preferences.language, Language::English);
        assert_eq!(preferences.appearance, Appearance::Dark);
        assert_eq!(preferences.zoom_percent, 100);
        assert!(!preferences.onboarded);
        Ok(())
    }

    #[test]
    fn choices_survive_saving_and_the_language_is_the_one_agents_read() -> Result<()> {
        let app = TempApp::new();
        let chosen = Preferences {
            language: Language::Italian,
            appearance: Appearance::Light,
            zoom_percent: 125,
            onboarded: true,
        };
        chosen.save(&app)?;
        assert_eq!(Preferences::load(&app)?, chosen);
        let shared: LanguagePreferences = app.preferences()?;
        assert_eq!(shared.language, Language::Italian);
        Ok(())
    }
}
