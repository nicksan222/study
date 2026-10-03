//! The ChatGPT account the language models run on: its card in the Language models
//! section, signing in (shared with the welcome tour) and signing out.

use super::super::super::ids;
use super::Busy;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, button::ButtonVariants as _};
use gpui_kit::{ParentElement as _, Styled as _};
use study_app::chat::ChatGptAccount;
use study_app::chat::provider::chatgpt::USAGE_SETTINGS_URL;
use study_core::ErrorKind;
use study_ui::{button, units};

impl AppShell {
    /// The ChatGPT account as one block on the fill: the plan's mark, where the account
    /// stands and what to do next on the left, and its actions on the right. Testing the
    /// connection sits here too, since the plan is the only thing it reaches.
    pub(super) fn chatgpt_account_card(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let state = &self.llm;
        let busy = state.busy.is_some();
        let unit = units(cx);
        let colors = cx.theme().colors;
        let palette = study_ui::palette(cx);
        let line = move |message: Message| {
            div()
                .whitespace_normal()
                .text_size(unit(study_ui::scale::TEXT_SMALL))
                .text_color(colors.muted_foreground)
                .child(text(locale, message))
        };
        let sign_in = |label: Message, reconsent: bool, cx: &mut Context<Self>| {
            button(ids::LLM_SIGN_IN, text(locale, label), cx)
                .primary()
                .disabled(busy)
                .on_click(cx.listener(move |this, _, _, cx| this.sign_in_chatgpt(reconsent, cx)))
        };
        let sign_out = |cx: &mut Context<Self>| {
            button(
                ids::LLM_SIGN_OUT,
                text(locale, Message::LlmChatGptSignOut),
                cx,
            )
            .disabled(busy)
            .on_click(cx.listener(|this, _, _, cx| this.sign_out_chatgpt(cx)))
        };
        let actions = div()
            .flex_none()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_SM));
        let usable = state
            .connections
            .chatgpt
            .as_ref()
            .is_some_and(ChatGptAccount::is_usable);
        let (body, actions) = match &state.connections.chatgpt {
            _ if state.busy == Some(Busy::SigningIn) => (
                vec![
                    line(Message::LlmChatGptHint),
                    line(Message::LlmChatGptWaiting),
                ],
                actions,
            ),
            None => (
                vec![line(Message::LlmChatGptHint)],
                actions.child(sign_in(Message::LlmChatGptSignIn, false, cx)),
            ),
            Some(account) if !account.is_usable() => (
                vec![line(Message::LlmChatGptNotSharing)]
                    .into_iter()
                    .chain(account.email.clone().map(|email| {
                        div()
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .child(email)
                    }))
                    .collect(),
                actions
                    .child(sign_in(Message::LlmChatGptAllowPlan, true, cx))
                    .child(sign_out(cx)),
            ),
            Some(account) => (
                vec![
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_x(unit(study_ui::scale::SPACE_SM))
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .child(text(locale, Message::LlmChatGptUsingPlan))
                        .children(
                            account.email.clone().map(|email| {
                                div().text_color(colors.muted_foreground).child(email)
                            }),
                        ),
                ],
                actions
                    .child(
                        button(ids::LLM_TEST, text(locale, Message::TestConnection), cx)
                            .disabled(busy)
                            .on_click(cx.listener(|this, _, _, cx| this.test_llm_connections(cx))),
                    )
                    .child(
                        button(
                            ids::LLM_MANAGE_USAGE,
                            text(locale, Message::LlmChatGptManageUsage),
                            cx,
                        )
                        .on_click(|_, _, cx| cx.open_url(USAGE_SETTINGS_URL)),
                    )
                    .child(sign_out(cx)),
            ),
        };
        div()
            .w_full()
            .p(unit(study_ui::scale::SPACE_LG))
            .rounded(unit(study_ui::scale::RADIUS_MD))
            .bg(palette.fill)
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_LG))
            .child(
                study_ui::icon(IconName::Cloud)
                    .size(unit(24.))
                    .flex_none()
                    .text_color(if usable {
                        colors.success
                    } else {
                        palette.muted
                    }),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(unit(240.))
                    .flex()
                    .flex_col()
                    .gap(unit(study_ui::scale::SPACE_XXS))
                    .child(study_ui::heading(
                        text(locale, Message::LlmProviderChatGpt),
                        cx,
                    ))
                    .children(body),
            )
            .child(actions)
    }

    /// Signs in to ChatGPT in the browser. `reconsent` asks again to share the plan, for
    /// a user who declined it the first time.
    fn sign_in_chatgpt(&mut self, reconsent: bool, cx: &mut Context<Self>) {
        self.run_chatgpt_sign_in(reconsent, cx, |view, _, _| view.llm.failed.clear());
    }

    /// Signs in to ChatGPT in the browser, for Settings and the welcome tour alike: opens
    /// the sign-in page, waits for it, keeps the account and the outcome for the Language
    /// models section, and hands `done` the outcome, or the message saying why it failed.
    ///
    /// The section's busy flag is the one record of a sign-in in flight, whoever started it,
    /// so Settings waits on one the tour started, even after the tour closes. Returns `false`,
    /// starting nothing, while the section is busy.
    pub(in crate::ui::screens::shell::page) fn run_chatgpt_sign_in(
        &mut self,
        reconsent: bool,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, Result<(), Message>, &mut Context<Self>) + 'static,
    ) -> bool {
        if self.llm.busy.is_some() {
            return false;
        }
        self.llm.busy = Some(Busy::SigningIn);
        self.llm.notice = None;
        cx.notify();
        let app = self.app.clone();
        cx.spawn(async move |this, cx| {
            // Both halves run on the app's runtime, which their network calls need.
            let start_app = app.clone();
            let start = app.spawn(async move { start_app.start_chatgpt_sign_in(reconsent).await });
            let result = match start.await {
                Ok(Ok(sign_in)) => {
                    let url = sign_in.url().to_owned();
                    cx.update(|cx| cx.open_url(&url));
                    let finish_app = app.clone();
                    let finish =
                        app.spawn(async move { finish_app.finish_chatgpt_sign_in(sign_in).await });
                    finish.await.unwrap_or_else(|error| Err(error.into()))
                }
                Ok(Err(error)) => Err(error),
                Err(error) => Err(error.into()),
            };
            let _ = this.update(cx, |view, cx| {
                let result = match result {
                    Ok(account) => {
                        view.llm.connections.chatgpt = Some(account);
                        Ok(())
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        Err(match error.kind() {
                            ErrorKind::Cancelled => Message::LlmChatGptSignInCancelled,
                            ErrorKind::Config => Message::LlmChatGptNotEligible,
                            _ => Message::LlmChatGptSignInFailed,
                        })
                    }
                };
                // Settings tells the outcome too, so a sign-in the tour started still says
                // how it ended once the tour is gone.
                let notice = match result {
                    Ok(()) if view.chatgpt_account().is_some() => {
                        (Message::LlmChatGptSignedIn, false)
                    }
                    Ok(()) => (Message::LlmChatGptNotSharing, true),
                    Err(message) => (message, true),
                };
                view.llm.busy = None;
                view.llm.notice = Some(notice);
                // A failure the tour showed before is old news now, whoever signed in.
                view.forget_tour_sign_in_failure();
                done(view, result, cx);
                cx.notify();
            });
        })
        .detach();
        true
    }

    /// Whether the Language models section is busy (saving, testing, signing in or out),
    /// so a sign-in cannot start.
    pub(in crate::ui::screens::shell::page) fn llm_busy(&self) -> bool {
        self.llm.busy.is_some()
    }

    /// Whether a ChatGPT sign-in, from Settings or the welcome tour, is waiting for the
    /// browser.
    pub(in crate::ui::screens::shell::page) fn chatgpt_signing_in(&self) -> bool {
        self.llm.busy == Some(Busy::SigningIn)
    }

    /// The signed-in ChatGPT account, if it shares its plan.
    pub(in crate::ui::screens::shell::page) fn chatgpt_account(&self) -> Option<&ChatGptAccount> {
        self.llm
            .connections
            .chatgpt
            .as_ref()
            .filter(|account| account.is_usable())
    }

    /// Signs out of ChatGPT here and at OpenAI.
    fn sign_out_chatgpt(&mut self, cx: &mut Context<Self>) {
        if self.llm.busy.is_some() || self.llm.connections.chatgpt.is_none() {
            return;
        }
        self.llm.busy = Some(Busy::SigningOut);
        self.llm.notice = None;
        cx.notify();
        let app = self.app.clone();
        let sign_out = self.app.spawn(async move { app.sign_out_chatgpt().await });
        cx.spawn(async move |this, cx| {
            let result = sign_out.await.unwrap_or_else(|error| Err(error.into()));
            let _ = this.update(cx, |view, cx| {
                let state = &mut view.llm;
                state.busy = None;
                state.notice = Some(match result {
                    Ok(()) => {
                        state.connections.chatgpt = None;
                        (Message::LlmChatGptSignedOut, false)
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        (Message::SaveError, true)
                    }
                });
                cx.notify();
            });
        })
        .detach();
    }
}
