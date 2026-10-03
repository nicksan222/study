//! Settings: the sidebar of sections, and the page that shows the chosen one. Each section
//! is drawn in `components/`: `general.rs` (language and appearance), `processing.rs` (what
//! runs on each kind of file), and a file per AI feature, each with a `status` that the AI
//! overview (`overview.rs`) and the sidebar show.

use super::ids;
use crate::ui::screens::shell::page::pages::components::status_line;
use crate::ui::screens::shell::page::*;
use study_localization::joined;
use study_ui::{ContentPage, MenuItem, MenuSection, SectionSidebar, scaled_px};

impl SettingsSection {
    /// Whether the sidebar marks the section with its feature's readiness: only where the
    /// section is the feature, a model to download or a plan to sign in to. This computer's
    /// section is its hardware and measurements; the search model it also holds says how
    /// ready it is on the AI overview, under its own name, not as "Not downloaded" beside the
    /// computer.
    fn shows_readiness(self) -> bool {
        match self {
            Self::Llm | Self::Transcription => true,
            Self::System
            | Self::Language
            | Self::Appearance
            | Self::Updates
            | Self::Processing
            | Self::Ai => false,
        }
    }
}

impl AppShell {
    /// Starts loading every section whose settings are read from the database, when
    /// Settings opens. A new section that loads anything adds its `ensure_*_loaded` here.
    pub(in crate::ui::screens::shell::page) fn load_settings_sections(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        self.ensure_transcription_loaded(cx);
        self.ensure_llm_loaded(cx);
        self.ensure_processing_loaded(cx);
    }

    /// Keeps Settings in step while it is on screen: the search model's readiness, which the
    /// sidebar and the overview show everywhere, and the text fields of the open section.
    /// Runs from `render`, where a window is at hand.
    pub(in crate::ui::screens::shell::page) fn sync_settings(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.sync_system(cx);
        match self.settings_section {
            SettingsSection::Transcription => self.sync_transcription_inputs(locale, window, cx),
            SettingsSection::Language
            | SettingsSection::Appearance
            | SettingsSection::Updates
            | SettingsSection::Processing
            | SettingsSection::Llm
            | SettingsSection::Ai
            | SettingsSection::System => {}
        }
    }

    /// A Settings section in the sidebar; an AI section waiting on a sign-in or a download
    /// of its own says so after its subtitle (see `SettingsSection::shows_readiness`), where
    /// it has the row's full width.
    fn section_button(
        &self,
        section: SettingsSection,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> MenuItem {
        let subtitle = text(locale, section.menu_subtitle()).to_string();
        let description = match self.ai_status(section, locale) {
            Some(status) if section.shows_readiness() && status.readiness.waits() => {
                joined(&[subtitle, text(locale, status.readiness.label()).to_string()])
            }
            _ => subtitle,
        };
        MenuItem::new(
            ids::SECTION + section as usize,
            text(locale, section.title()),
        )
        .icon(section.icon())
        .description(description)
        .selected(section == self.settings_section)
        .on_click(cx.listener(move |this, _, _, cx| {
            this.settings_section = section;
            cx.notify();
        }))
    }

    /// Settings by `SettingsGroup`: how the app looks, and the AI features with their
    /// readiness. Each group lists its sections in `SettingsSection::ALL` order.
    pub(in crate::ui::screens::shell::page) fn settings_sidebar(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> SectionSidebar {
        // The groups' labels head the list; the navigation already names Settings.
        let mut sidebar = SectionSidebar::untitled();
        for (index, group) in SettingsGroup::ALL.into_iter().enumerate() {
            if index > 0 {
                sidebar = sidebar.item(div().h(scaled_px(cx, 12.)));
            }
            let menu = SettingsSection::ALL
                .into_iter()
                .filter(|section| section.group() == group)
                .fold(
                    MenuSection::new(text(locale, group.title())),
                    |menu, section| menu.item(self.section_button(section, locale, cx)),
                );
            sidebar = sidebar.item(menu);
        }
        sidebar
    }

    pub(in crate::ui::screens::shell::page) fn settings_page(
        &self,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let locale = self.preferences.language;
        let section = self.settings_section;
        let page = ContentPage::new(
            text(locale, section.title()),
            text(locale, section.description()),
        )
        .icon(section.icon());
        let page = match section {
            SettingsSection::Language => self.language_page(page, locale, cx),
            SettingsSection::Appearance => self.appearance_page(page, locale, cx),
            SettingsSection::Updates => return self.updates_page(page, locale, cx),
            SettingsSection::Processing => return self.processing_page(page, locale, cx),
            SettingsSection::Ai => self.ai_overview_page(page, locale, cx),
            SettingsSection::Transcription => {
                return self.transcription_page(page, locale, cx);
            }
            SettingsSection::Llm => return self.llm_page(page, locale, cx),
            SettingsSection::System => return self.system_page(page, locale, cx),
        };
        status_line(
            page,
            self.save_error.then_some(Message::SaveError),
            self.saving.running(),
            locale,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::ui::screens::shell::page::testing::{click, open_shell};
    use gpui_kit::TestAppContext;

    /// The overview says whether the search model is on disk; the sidebar's row for this
    /// computer, about its hardware, never does. Models live in the shared cache, so the
    /// model may or may not be there.
    #[gpui_kit::test]
    fn this_computer_is_never_marked_not_downloaded(cx: &mut TestAppContext) {
        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        click(cx, window, Page::Settings as usize);
        cx.update(|cx| {
            shell
                .read(cx)
                .ai_status(SettingsSection::System, Locale::English)
                .expect("this computer's section holds the search model")
        });
        assert!(!SettingsSection::System.shows_readiness());
        // Transcription's own model is what its section downloads.
        assert!(SettingsSection::Transcription.shows_readiness());
    }
}
