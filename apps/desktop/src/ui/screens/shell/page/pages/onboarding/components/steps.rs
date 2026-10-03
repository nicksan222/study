//! What the tour's own steps show: the language and look, signing in and the models that
//! run here, and the way out to the AI settings.

use super::super::ids;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, button::ButtonVariants as _};
use study_localization::{joined, media_size};
use study_ui::{button, scaled_px, units};

impl AppShell {
    /// Signing in to ChatGPT, whose plan runs the language models.
    fn chatgpt_choice(&self, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let line = |message, color| note(locale, message, color, cx);
        let choice = div()
            .w_full()
            .max_w(unit(420.))
            .pb(unit(study_ui::scale::SPACE_MD))
            .flex()
            .flex_col()
            .items_center()
            .gap(unit(8.));
        if self.chatgpt_account().is_some() {
            return choice.child(line(Message::OnboardingAiChatGptReady, colors.success));
        }
        if self.chatgpt_signing_in() {
            return choice.child(line(Message::LlmChatGptWaiting, colors.muted_foreground));
        }
        choice
            .child(line(Message::OnboardingAiChatGpt, colors.muted_foreground))
            .child(
                button(
                    ids::CHATGPT_SIGN_IN,
                    text(locale, Message::LlmChatGptSignIn),
                    cx,
                )
                .icon(IconName::Cloud)
                // A sign-in waits while Settings saves or tests the language models.
                .disabled(self.onboarding.downloading || self.llm_busy())
                .on_click(cx.listener(|this, _, _, cx| this.use_chatgpt_plan(cx))),
            )
            .children(
                self.onboarding
                    .sign_in_failed
                    .map(|message| line(message, colors.danger)),
            )
    }

    /// The language and the look, the same choices Settings offers, applied at once.
    pub(in crate::ui::screens::shell::page::pages::onboarding) fn look_step(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let unit = units(cx);
        let languages = self.language_choices(locale, cx);
        let looks = self.appearance_choices(locale, cx);
        let label = |message: Message, cx: &Context<Self>| {
            div()
                .text_size(scaled_px(cx, study_ui::scale::TEXT_SMALL))
                .font_weight(gpui_kit::FontWeight::MEDIUM)
                .text_color(cx.theme().colors.muted_foreground)
                .child(text(locale, message))
        };
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(12.))
            .child(label(Message::Language, cx))
            .child(languages)
            .child(div().h(unit(8.)))
            .child(label(Message::Appearance, cx))
            .child(looks)
    }

    /// Signing in to ChatGPT, then what runs here, with one button that downloads what is
    /// missing.
    pub(in crate::ui::screens::shell::page::pages::onboarding) fn ai_step(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let unit = units(cx);
        let muted = cx.theme().colors.muted_foreground;
        let mut step = div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(unit(14.))
            .child(self.chatgpt_choice(locale, cx));
        match (&self.startup, self.system.report()) {
            (_, Some(report)) => {
                step = step.child(self.model_placements(report, locale, cx));
                let missing = self.models_to_download();
                if self.onboarding.downloading {
                    step = step.child(waiting(locale, Message::OnboardingAiDownloading, cx));
                } else if !missing.is_empty() {
                    let bytes: u64 = missing.iter().map(|&m| self.app.model_size(m)).sum();
                    step = step.child(
                        button(
                            ids::DOWNLOAD,
                            joined(&[
                                text(locale, Message::OnboardingAiDownload).to_owned(),
                                media_size(locale, bytes as i64),
                            ]),
                            cx,
                        )
                        .icon(IconName::Download)
                        .on_click(cx.listener(|this, _, _, cx| this.download_local_models(cx))),
                    );
                    if self.onboarding.downloaded == Some(false) {
                        let danger = cx.theme().colors.danger;
                        step = step.child(note(locale, Message::ModelDownloadError, danger, cx));
                    }
                    step = step.child(note(locale, Message::OnboardingAiWaitForModels, muted, cx));
                } else {
                    let success = cx.theme().colors.success;
                    step = step.child(note(locale, Message::OnboardingAiDownloaded, success, cx));
                }
            }
            (pages::Startup::Failed, None) => {
                step = step.child(note(locale, Message::OnboardingAiFailed, muted, cx));
            }
            (_, None) => step = step.child(waiting(locale, Message::StartupMeasuring, cx)),
        }
        step.child(note(locale, Message::OnboardingAiLater, muted, cx))
    }

    /// The last step's extra way out: straight to the AI settings.
    pub(in crate::ui::screens::shell::page::pages::onboarding) fn ready_step(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        div().w_full().flex().justify_center().child(
            button(
                ids::OPEN_AI_SETTINGS,
                text(locale, Message::OnboardingOpenAiSettings),
                cx,
            )
            .ghost()
            .icon(IconName::Sparkles)
            .on_click(
                cx.listener(|this, _, _, cx| this.finish_onboarding(Some(SettingsSection::Ai), cx)),
            ),
        )
    }
}

/// A centered line of the AI step, in `color`.
fn note(
    locale: Locale,
    message: Message,
    color: gpui_kit::Hsla,
    cx: &gpui_kit::App,
) -> gpui_kit::Div {
    div()
        .w_full()
        .text_center()
        .text_size(scaled_px(cx, study_ui::scale::TEXT_SMALL))
        .text_color(color)
        .child(text(locale, message))
}

/// What the AI step waits for, over a bar that moves until it is done.
fn waiting(locale: Locale, message: Message, cx: &gpui_kit::App) -> gpui_kit::Div {
    let unit = units(cx);
    div()
        .w_full()
        .max_w(unit(420.))
        .flex()
        .flex_col()
        .gap(unit(8.))
        .child(note(
            locale,
            message,
            cx.theme().colors.muted_foreground,
            cx,
        ))
        .child(
            gpui_kit::component::progress::Progress::new(ids::DOWNLOAD_PROGRESS)
                .accessibility_label(text(locale, message))
                .loading(true)
                .w_full(),
        )
}
