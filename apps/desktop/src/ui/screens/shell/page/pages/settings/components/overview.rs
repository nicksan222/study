//! The AI overview of Settings: every AI feature at a glance, what it is for, where it runs,
//! whether it is ready, and a way straight to the section that sets it up. The same
//! readiness marks each AI section in the Settings sidebar.

use super::super::ids;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, Sizable as _};
use gpui_kit::{App, Div, FontWeight, ParentElement as _, SharedString, Styled as _};
use study_app::LocalModel;
use study_localization::{joined, media_size};
use study_ui::{ContentPage, button, units};

/// How far along an AI feature's setup is.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::ui::screens::shell::page) enum Readiness {
    /// Its settings are still loading.
    Checking,
    Ready,
    /// It uses a provider the user signs in to, and nobody is signed in.
    NeedsSignIn,
    /// It runs on this computer and its model is not downloaded.
    NeedsDownload,
}

impl Readiness {
    pub(in crate::ui::screens::shell::page::pages::settings) fn label(self) -> Message {
        match self {
            Self::Checking => Message::AiChecking,
            Self::Ready => Message::AiReady,
            Self::NeedsSignIn => Message::AiNeedsSignIn,
            Self::NeedsDownload => Message::AiNeedsDownload,
        }
    }

    /// Whether the feature waits on the learner (a sign-in or a download), which the
    /// Settings sidebar says; ready and checking need nothing, so it stays quiet about them.
    pub(in crate::ui::screens::shell::page) fn waits(self) -> bool {
        match self {
            Self::NeedsSignIn | Self::NeedsDownload => true,
            Self::Checking | Self::Ready => false,
        }
    }
}

/// Where an AI feature runs, and how ready it is.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::ui::screens::shell::page) struct Status {
    pub readiness: Readiness,
    /// On this computer, or the online service it uses.
    pub place: String,
    pub local: bool,
}

/// A readiness as a quiet caption: setup and waiting are normal states, not alarms, so the
/// word carries it in the faint ink (`DESIGN.md`, the Quiet Success Rule).
fn readiness_caption(readiness: Readiness, locale: Locale, cx: &App) -> Div {
    let unit = units(cx);
    div()
        .flex_none()
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(study_ui::palette(cx).faint)
        .child(text(locale, readiness.label()))
}

/// An AI feature's row on the overview: its icon, its name and what it is for.
#[derive(Clone, Copy, Debug)]
struct FeatureCard {
    icon: IconName,
    title: Message,
    purpose: Message,
}

impl SettingsSection {
    /// The overview's row for the AI feature this section sets up, if it sets one up. The
    /// overview shows these in `SettingsSection::ALL` order.
    fn feature_card(self) -> Option<FeatureCard> {
        let card = |icon, title, purpose| {
            Some(FeatureCard {
                icon,
                title,
                purpose,
            })
        };
        match self {
            Self::Llm => card(IconName::BrainCircuit, Message::Llm, Message::AiLlmPurpose),
            Self::Transcription => card(
                IconName::AudioLines,
                Message::Transcription,
                Message::AiTranscriptionPurpose,
            ),
            // This computer's section holds the search model.
            Self::System => card(IconName::Search, Message::Search, Message::AiSearchPurpose),
            Self::Language | Self::Appearance | Self::Updates | Self::Processing | Self::Ai => None,
        }
    }
}

impl AppShell {
    /// The readiness of the AI feature a Settings section sets up, if it sets one up.
    pub(in crate::ui::screens::shell::page) fn ai_status(
        &self,
        section: SettingsSection,
        locale: Locale,
    ) -> Option<Status> {
        match section {
            SettingsSection::Llm => Some(self.llm.status(locale)),
            SettingsSection::Transcription => Some(self.transcription.status(locale)),
            SettingsSection::System => Some(self.search_status(locale)),
            SettingsSection::Language
            | SettingsSection::Appearance
            | SettingsSection::Updates
            | SettingsSection::Processing
            | SettingsSection::Ai => None,
        }
    }

    /// Search always runs here; it is ready once its model is on disk.
    fn search_status(&self, locale: Locale) -> Status {
        let readiness = match self.system.search_installed() {
            None => Readiness::Checking,
            Some(true) => Readiness::Ready,
            Some(false) => Readiness::NeedsDownload,
        };
        Status {
            readiness,
            place: text(locale, Message::AiSearchPrivate).to_owned(),
            local: true,
        }
    }

    pub(in crate::ui::screens::shell::page) fn ai_overview_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let unit = units(cx);
        let mut list = div().w_full().flex().flex_col();
        let features = SettingsSection::ALL
            .into_iter()
            .filter_map(|section| Some((section, section.feature_card()?)));
        for (index, (section, card)) in features.enumerate() {
            let Some(status) = self.ai_status(section, locale) else {
                continue;
            };
            list = list.child(self.feature_row(index, section, card, status, locale, cx));
        }
        let muted = cx.theme().colors.muted_foreground;
        page.item(list).item(
            div()
                .mt(unit(20.))
                .w_full()
                .flex()
                .items_start()
                .gap(unit(8.))
                .text_size(unit(study_ui::scale::TEXT_SMALL))
                .text_color(muted)
                .child(
                    study_ui::icon(IconName::ShieldCheck)
                        .size(unit(16.))
                        .flex_none(),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .whitespace_normal()
                        .child(text(locale, Message::AiPrivacyNote)),
                ),
        )
    }

    /// One AI feature's row: what it is for, where it runs, whether it is ready, and one action.
    fn feature_row(
        &self,
        index: usize,
        section: SettingsSection,
        card: FeatureCard,
        status: Status,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Div {
        let colors = cx.theme().colors;
        let unit = units(cx);
        let id = ids::OVERVIEW_ACTION + index;
        // Search downloads its model right here; everything else opens its section.
        let action =
            if section == SettingsSection::System && status.readiness == Readiness::NeedsDownload {
                let size = media_size(locale, self.app.model_size(LocalModel::Search) as i64);
                button(
                    id,
                    joined(&[text(locale, Message::DownloadModel).to_owned(), size]),
                    cx,
                )
                .primary()
                .small()
                .disabled(self.system.installing())
                .on_click(cx.listener(|this, _, _, cx| this.install_search_model(cx)))
            } else {
                let (label, primary) = match status.readiness {
                    Readiness::NeedsSignIn | Readiness::NeedsDownload => (Message::AiSetUp, true),
                    Readiness::Ready | Readiness::Checking => (Message::AiOpen, false),
                };
                let open = button(id, text(locale, label), cx)
                    .small()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.settings_section = section;
                        cx.notify();
                    }));
                if primary { open.primary() } else { open }
            };
        div()
            .w_full()
            .py(unit(study_ui::scale::SPACE_MD))
            .flex()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_LG))
            .child(
                study_ui::icon(card.icon)
                    .size(unit(20.))
                    .flex_none()
                    .text_color(colors.muted_foreground),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(unit(study_ui::scale::SPACE_XXS))
                    .child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(unit(study_ui::scale::SPACE_SM))
                            .child(
                                div()
                                    .text_size(unit(study_ui::scale::TEXT_UI))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(text(locale, card.title)),
                            )
                            .child(readiness_caption(status.readiness, locale, cx)),
                    )
                    .child(
                        div()
                            .whitespace_normal()
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .text_color(colors.muted_foreground)
                            .child(text(locale, card.purpose)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(unit(6.))
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .text_color(study_ui::palette(cx).faint)
                            .child(
                                study_ui::icon(if status.local {
                                    IconName::HardDrive
                                } else {
                                    IconName::Cloud
                                })
                                .size(unit(12.)),
                            )
                            .child(SharedString::from(status.place)),
                    ),
            )
            .child(div().flex_none().child(action))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::ui::screens::shell::page::testing::{click, open_shell};
    use gpui_kit::{Entity, TestAppContext};

    fn llm_status(cx: &mut TestAppContext, shell: &Entity<AppShell>) -> Status {
        cx.update(|cx| {
            shell
                .read(cx)
                .ai_status(SettingsSection::Llm, Locale::English)
                .unwrap()
        })
    }

    #[test]
    fn every_ai_section_but_the_overview_has_a_card() {
        for section in SettingsSection::ALL {
            let expected = section.group() == SettingsGroup::Ai && section != SettingsSection::Ai;
            assert_eq!(section.feature_card().is_some(), expected, "{section:?}");
        }
    }

    #[gpui_kit::test]
    fn a_fresh_install_needs_a_chatgpt_sign_in_and_the_overview_leads_there(
        cx: &mut TestAppContext,
    ) {
        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());

        click(cx, window, Page::Settings as usize);
        click(cx, window, ids::SECTION + SettingsSection::Ai as usize);
        // Every tier runs on the ChatGPT plan, which nobody signed in to yet.
        let status = llm_status(cx, &shell);
        assert_eq!(
            (status.readiness, status.local, status.place.as_str()),
            (Readiness::NeedsSignIn, false, "Your ChatGPT plan")
        );

        // The language models card opens its section.
        click(cx, window, ids::OVERVIEW_ACTION);
        assert_eq!(
            cx.update(|cx| shell.read(cx).settings_section),
            SettingsSection::Llm
        );
    }
}
