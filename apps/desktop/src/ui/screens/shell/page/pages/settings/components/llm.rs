//! The Language models section of Settings: the model that serves each tier, and the
//! ChatGPT account they all run on.
//!
//! Works like the Transcription section: each tier's model is picked from the ones its
//! provider offers, into a draft that is stored only when the user presses Save, and the
//! connection test never changes what is stored. A provider's connection is shared by every
//! tier it serves, so it is set up once, below the tiers. Signing in and out takes effect
//! at once, apart from Save; the account is in `chatgpt.rs`.

mod chatgpt;

use super::super::ids;
use super::overview::{Readiness, Status};
use super::settings_card;
use super::{invalid_message, unloaded_page, with_status};
use crate::features::llm as engine;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, IconName,
    button::ButtonVariants as _,
    menu::{DropdownMenu as _, PopupMenuItem},
};
use gpui_kit::{ParentElement as _, Styled as _, prelude::FluentBuilder as _};
use study_app::chat::{Connections, LlmForm, LlmModel, LlmPreferences, LlmProvider, Tier};
use study_ui::{ContentPage, button, units};

/// What the section is doing; while it does, every other action waits.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Busy {
    Saving,
    Testing,
    SigningIn,
    SigningOut,
}

/// The Language models section: the draft of each tier's model, and the connections.
pub(in crate::ui::screens::shell::page) struct LlmState {
    /// The models as picked; stored only by Save.
    draft: LlmForm,
    /// The providers' credentials, as last loaded; they are not part of the draft.
    connections: Connections,
    loaded: bool,
    loading: bool,
    /// The draft differs from what is stored.
    dirty: bool,
    busy: Option<Busy>,
    /// The latest outcome to report, and whether it is an error.
    notice: Option<(Message, bool)>,
    /// Tiers whose model did not answer the last connection test.
    failed: Vec<Tier>,
}

impl LlmState {
    pub(in crate::ui::screens::shell::page) fn new() -> Self {
        Self {
            draft: LlmForm::default(),
            connections: Connections::default(),
            loaded: false,
            loading: false,
            dirty: false,
            busy: None,
            notice: None,
            failed: Vec::new(),
        }
    }

    /// Where the language models run and whether every tier can.
    pub(super) fn status(&self, locale: Locale) -> Status {
        let readiness = if !self.loaded {
            Readiness::Checking
        } else if let Some((_, provider)) = self
            .draft
            .parse()
            .ok()
            .and_then(|preferences| preferences.first_unready(&self.connections))
        {
            match provider {
                LlmProvider::ChatGpt => Readiness::NeedsSignIn,
            }
        } else {
            Readiness::Ready
        };
        let providers: Vec<String> = self
            .providers_in_use()
            .map(|provider| text(locale, provider_label(provider)).to_owned())
            .collect();
        Status {
            readiness,
            place: study_localization::joined(&providers),
            local: self
                .providers_in_use()
                .all(LlmProvider::runs_on_this_computer),
        }
    }

    /// The providers in use, in the order the page lists them.
    fn providers_in_use(&self) -> impl Iterator<Item = LlmProvider> + '_ {
        LlmProvider::ALL.iter().copied().filter(|&provider| {
            Tier::ALL
                .iter()
                .any(|&tier| self.draft.tier(tier).provider == provider)
        })
    }
}

fn tier_labels(tier: Tier) -> (Message, Message) {
    match tier {
        Tier::Tiny => (Message::LlmTierTiny, Message::LlmTierTinySubtitle),
        Tier::Medium => (Message::LlmTierMedium, Message::LlmTierMediumSubtitle),
        Tier::Smart => (Message::LlmTierSmart, Message::LlmTierSmartSubtitle),
    }
}

fn model_label(model: LlmModel) -> Message {
    match model {
        LlmModel::Gpt6Luna => Message::ModelGpt6Luna,
        LlmModel::Gpt61Sol => Message::ModelGpt61Sol,
        LlmModel::Gpt6Astra => Message::ModelGpt6Astra,
    }
}

fn provider_label(provider: LlmProvider) -> Message {
    match provider {
        LlmProvider::ChatGpt => Message::LlmProviderChatGpt,
    }
}

impl AppShell {
    pub(in crate::ui::screens::shell::page) fn ensure_llm_loaded(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        if !self.llm.loaded && !self.llm.loading {
            self.load_llm(cx);
        }
    }

    fn load_llm(&mut self, cx: &mut Context<Self>) {
        if self.llm.loading {
            return;
        }
        self.llm.loading = true;
        self.llm.notice = None;
        cx.notify();
        self.background(
            move |app| {
                Ok::<_, study_core::Error>((
                    app.preferences::<LlmPreferences>()?,
                    app.connections()?,
                ))
            },
            move |view, result, cx| {
                let state = &mut view.llm;
                state.loading = false;
                match result {
                    Ok((preferences, connections)) => {
                        state.draft = LlmForm::from(&preferences);
                        state.connections = connections;
                        state.loaded = true;
                        state.dirty = false;
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        state.notice = Some((Message::LlmLoadError, true));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Picks `model` for `tier`, or its recommended model for `None`, in the draft.
    fn pick_llm_model(&mut self, tier: Tier, model: Option<LlmModel>, cx: &mut Context<Self>) {
        let state = &mut self.llm;
        if state.draft.tier(tier).model == model {
            return;
        }
        state.draft.tier_mut(tier).model = model;
        state.dirty = true;
        state.notice = None;
        state.failed.retain(|&failed| failed != tier);
        cx.notify();
    }

    /// The draft as preferences, or `None` after saying what in it is wrong.
    fn parse_llm_draft(&mut self, cx: &mut Context<Self>) -> Option<LlmPreferences> {
        match self.llm.draft.parse() {
            Ok(preferences) => Some(preferences),
            Err(invalid) => {
                self.llm.notice = Some((invalid_message(invalid), true));
                cx.notify();
                None
            }
        }
    }

    fn save_llm(&mut self, cx: &mut Context<Self>) {
        let state = &self.llm;
        if state.busy.is_some() || !state.loaded || !state.dirty {
            return;
        }
        let draft = state.draft.clone();
        let Some(preferences) = self.parse_llm_draft(cx) else {
            return;
        };
        self.llm.busy = Some(Busy::Saving);
        self.llm.notice = None;
        cx.notify();
        let saved = preferences.clone();
        self.background(
            move |app| app.save_preferences(&saved),
            move |view, result, cx| {
                let state = &mut view.llm;
                state.busy = None;
                state.notice = Some(match result {
                    Ok(()) => {
                        // Unless another model was picked meanwhile, the draft is what is stored.
                        if state.draft == draft {
                            state.draft = LlmForm::from(&preferences);
                            state.dirty = false;
                        }
                        (Message::SettingsSaved, false)
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        (Message::SaveError, true)
                    }
                });
                cx.notify();
            },
            cx,
        );
    }

    fn test_llm_connections(&mut self, cx: &mut Context<Self>) {
        if self.llm.busy.is_some() || !self.llm.loaded {
            return;
        }
        let Some(preferences) = self.parse_llm_draft(cx) else {
            return;
        };
        let connections = self.llm.connections.clone();
        if let Some((_, provider)) = preferences.first_unready(&connections) {
            self.llm.notice = Some((
                match provider {
                    LlmProvider::ChatGpt => Message::LlmChatGptSignInNeeded,
                },
                true,
            ));
            cx.notify();
            return;
        }
        self.llm.busy = Some(Busy::Testing);
        self.llm.notice = None;
        self.llm.failed.clear();
        cx.notify();
        let check = self
            .app
            .spawn(engine::check_connections(preferences, connections));
        cx.spawn(async move |this, cx| {
            // A test that could not run at all counts against every tier.
            let failed = check.await.unwrap_or_else(|_| Tier::ALL.to_vec());
            let _ = this.update(cx, |view, cx| {
                let state = &mut view.llm;
                state.busy = None;
                state.notice = Some(if failed.is_empty() {
                    (Message::ConnectionOk, false)
                } else {
                    (Message::ConnectionFailed, true)
                });
                state.failed = failed;
                cx.notify();
            });
        })
        .detach();
    }

    /// A tier's row: what it is for on the left; its model on the right.
    fn llm_tier_row(&self, tier: Tier, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let state = &self.llm;
        let (title, subtitle) = tier_labels(tier);
        let unit = units(cx);
        let colors = cx.theme().colors;
        let setup = *state.draft.tier(tier);
        let recommended = setup.provider.default_model(tier);
        let recommended =
            study_localization::recommended_model(locale, text(locale, model_label(recommended)));
        let current = match setup.model.filter(|m| m.provider() == setup.provider) {
            Some(model) => text(locale, model_label(model)).to_owned(),
            None => recommended.clone(),
        };
        let choices: Vec<(Option<LlmModel>, String)> = std::iter::once((None, recommended))
            .chain(
                LlmModel::of(setup.provider)
                    .map(|model| (Some(model), text(locale, model_label(model)).to_owned())),
            )
            .collect();
        let shell = cx.entity().downgrade();
        div()
            .w_full()
            .py(unit(12.))
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(12.))
            .when(tier != Tier::Tiny, |row| {
                row.border_t_1().border_color(colors.border.opacity(0.6))
            })
            .child(
                div()
                    .flex_1()
                    .min_w(unit(220.))
                    .flex()
                    .flex_col()
                    .gap(unit(2.))
                    .child(
                        div()
                            .text_size(unit(study_ui::scale::TEXT_UI))
                            .font_weight(gpui_kit::FontWeight::MEDIUM)
                            .child(text(locale, title)),
                    )
                    .child(
                        div()
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .line_height(unit(17.))
                            .text_color(colors.muted_foreground)
                            .child(text(locale, subtitle)),
                    )
                    .children(state.failed.contains(&tier).then(|| {
                        div()
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .text_color(colors.danger)
                            .child(text(locale, Message::LlmTierTestFailed))
                    })),
            )
            .child(
                div().flex_none().child(
                    button(ids::LLM_MODEL + tier as usize, current, cx)
                        .icon(IconName::ChevronDown)
                        .dropdown_menu(move |menu, _, _| {
                            choices.iter().fold(menu, |menu, (model, name)| {
                                let (shell, model) = (shell.clone(), *model);
                                menu.item(PopupMenuItem::new(name.clone()).on_click(
                                    move |_, _, cx| {
                                        let _ = shell.update(cx, |this, cx| {
                                            this.pick_llm_model(tier, model, cx)
                                        });
                                    },
                                ))
                            })
                        }),
                ),
            )
    }

    /// A provider's panel: what every tier on it shares, such as the account it signs in to.
    fn llm_provider_card(
        &self,
        provider: LlmProvider,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        match provider {
            LlmProvider::ChatGpt => self.chatgpt_account_card(locale, cx),
        }
    }

    pub(in crate::ui::screens::shell::page) fn llm_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let state = &self.llm;
        if !state.loaded {
            let retry = button(ids::LLM_RETRY, text(locale, Message::Retry), cx)
                .on_click(cx.listener(|this, _, _, cx| this.load_llm(cx)));
            return unloaded_page(
                page,
                locale,
                state.loading,
                state.notice,
                Message::LlmLoadError,
                retry,
            );
        }
        let busy = state.busy.is_some();
        let unit = units(cx);
        let mut models = settings_card(text(locale, Message::LlmModels), cx).child(
            div()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(cx.theme().colors.muted_foreground)
                .child(text(locale, Message::LlmModelHint)),
        );
        for tier in Tier::ALL {
            models = models.child(self.llm_tier_row(tier, locale, cx));
        }
        // Save shows only once there is a pick to keep.
        let models = models.when(state.dirty, |models| {
            models.child(
                div()
                    .pt(unit(study_ui::scale::SPACE_SM))
                    .flex()
                    .justify_end()
                    .child(
                        button(ids::LLM_SAVE, text(locale, Message::Save), cx)
                            .primary()
                            .disabled(busy)
                            .on_click(cx.listener(|this, _, _, cx| this.save_llm(cx))),
                    ),
            )
        });
        // The accounts come first: nothing below runs until they are signed in.
        let mut page = page;
        for provider in state.providers_in_use() {
            page = page.item(self.llm_provider_card(provider, locale, cx));
        }
        let page = page.item(models);
        let status = match state.busy {
            Some(Busy::Saving) => Some((Message::Saving, false)),
            Some(Busy::Testing) => Some((Message::TestingConnection, false)),
            Some(Busy::SigningIn) => Some((Message::LlmChatGptWaiting, false)),
            Some(Busy::SigningOut) => Some((Message::Saving, false)),
            None => state.notice,
        };
        with_status(page, locale, status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::ui::screens::shell::page::SettingsSection;
    use crate::ui::screens::shell::page::testing::{click, find, open_shell, wait_until};

    /// Each tier offers its recommended model and every model of its provider, apart.
    #[test]
    fn every_model_has_its_own_name() {
        let mut names: Vec<_> = LlmModel::ALL
            .iter()
            .map(|&model| text(Locale::English, model_label(model)))
            .collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), LlmModel::ALL.len());
        const { assert!(ids::LLM_MODEL + Tier::ALL.len() <= ids::OVERVIEW_ACTION) };
    }

    /// A model is picked, not typed, and stored by Save; the recommendation is a pick too.
    #[gpui_kit::test]
    fn a_picked_model_is_saved(cx: &mut gpui_kit::TestAppContext) {
        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        click(cx, window, Page::Settings as usize);
        click(cx, window, ids::SECTION + SettingsSection::Llm as usize);
        wait_until(cx, |cx| cx.update(|cx| shell.read(cx).llm.loaded));
        for t in Tier::ALL {
            assert!(find(cx, window, ids::LLM_MODEL + t as usize).is_some());
        }

        shell.update(cx, |this, cx| {
            this.pick_llm_model(Tier::Tiny, Some(LlmModel::Gpt6Astra), cx)
        });
        click(cx, window, ids::LLM_SAVE);
        let database = temp.database();
        wait_until(cx, |_| {
            LlmPreferences::load(&database).unwrap().tiny.model == Some(LlmModel::Gpt6Astra)
        });
        assert!(!cx.update(|cx| shell.read(cx).llm.dirty));

        shell.update(cx, |this, cx| this.pick_llm_model(Tier::Tiny, None, cx));
        click(cx, window, ids::LLM_SAVE);
        wait_until(cx, |_| {
            LlmPreferences::load(&database)
                .unwrap()
                .tiny
                .model
                .is_none()
        });
    }
}
