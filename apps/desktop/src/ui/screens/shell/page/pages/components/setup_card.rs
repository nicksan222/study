//! What a job waiting on setup shows wherever it is drawn: one card naming what is missing
//! (the ChatGPT plan, the transcription model or the search model), why Study needs it, and
//! the one step that fixes it, so the learner never meets a bare "Open settings".
//!
//! Signing in to ChatGPT happens right here; a model download opens its Settings section.
//! Work that waits picks up on its own once the requirement is met, and the card says so.

use super::job::{JobAction, retry_button};
use crate::features::jobs::Problem;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::button::ButtonVariants as _;
use gpui_kit::component::{Disableable as _, Icon, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{AnyElement, ElementId, FontWeight};
use study_app::views::{Job, JobStatus};
use study_core::job::Requirement;
use study_ui::{button, palette, scale, units};

/// What the card needs to know of the ChatGPT sign-in, read from the shell before drawing
/// (the shell cannot be read while it draws).
#[derive(Clone, Copy, Debug, Default)]
pub(in crate::ui::screens::shell::page) struct ChatGptState {
    /// No account shares its plan yet, so signing in is the step to offer.
    signed_out: bool,
    /// A sign-in waits for the browser.
    signing_in: bool,
    /// The Language models section is busy, so a sign-in cannot start.
    busy: bool,
}

impl AppShell {
    /// The ChatGPT sign-in as a setup card draws it.
    pub(in crate::ui::screens::shell::page) fn chatgpt_state(&self) -> ChatGptState {
        ChatGptState {
            signed_out: self.chatgpt_account().is_none(),
            signing_in: self.chatgpt_signing_in(),
            busy: self.llm_busy(),
        }
    }
}

/// The setup `job` is held up by, or failed for want of; `None` when nothing in Settings
/// would make it run.
pub(in crate::ui::screens::shell::page) fn setup_requirement(job: &Job) -> Option<Requirement> {
    job.needs.or(job.waiting_for).or_else(|| {
        Problem::of_job(job)
            .fixed_in_settings()
            .then(|| study_core::processing::requirement(job.kind, None))
            .flatten()
    })
}

/// What a version held up by the ChatGPT sign-in shows under its entry, in place of the
/// [`setup_card`]: one quiet line saying so, and the step that fixes it. `None` when the job
/// is held up by something else, or there is an account.
pub(in crate::ui::screens::shell::page) fn sign_in_line(
    job: &Job,
    chatgpt: ChatGptState,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<Vec<AnyElement>> {
    if !chatgpt.signed_out
        || job.status != JobStatus::Waiting
        || setup_requirement(job) != Some(Requirement::LanguageModels)
    {
        return None;
    }
    let label = if chatgpt.signing_in {
        Message::LlmChatGptWaiting
    } else {
        Message::VersionSignIn
    };
    Some(vec![
        div()
            .child(text(locale, Message::VersionWaitingSignIn))
            .into_any_element(),
        div()
            .child(study_localization::separator())
            .into_any_element(),
        button(
            ElementId::from(("setup-sign-in", job.id.get() as u64)),
            text(locale, label),
            cx,
        )
        .ghost()
        .xsmall()
        .disabled(chatgpt.busy)
        .on_click(cx.listener(|this, _, _, cx| {
            this.run_chatgpt_sign_in(false, cx, |_, _, _| {});
        }))
        .into_any_element(),
    ])
}

/// The card's look and words for each requirement.
fn copy(requirement: Requirement) -> (IconName, Message, Message) {
    match requirement {
        Requirement::LanguageModels => (
            IconName::BrainCircuit,
            Message::SetupLlmTitle,
            Message::SetupLlmBody,
        ),
        Requirement::Transcription => (
            IconName::AudioLines,
            Message::SetupTranscriptionTitle,
            Message::SetupTranscriptionBody,
        ),
        Requirement::SearchModel => (
            IconName::Search,
            Message::SetupSearchTitle,
            Message::SetupSearchBody,
        ),
    }
}

/// The card for `job`, held up by `requirement`: a highlighter disc with the requirement's
/// icon, what is missing and why, then the step that fixes it. `ids` are the retry and
/// settings buttons'; the in-place sign-in takes its id from the job.
pub(in crate::ui::screens::shell::page) fn setup_card(
    (retry_id, settings_id): (impl Into<ElementId>, impl Into<ElementId>),
    job: &Job,
    requirement: Requirement,
    chatgpt: ChatGptState,
    retry: JobAction,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let palette = palette(cx);
    let (icon, title, body) = copy(requirement);
    let (kind, job_id) = (job.kind, job.id);

    let mut actions = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(unit(scale::SPACE_XS))
        .mt(unit(scale::SPACE_XS));
    let sign_in = requirement == Requirement::LanguageModels && chatgpt.signed_out;
    if sign_in {
        let label = if chatgpt.signing_in {
            Message::LlmChatGptWaiting
        } else {
            Message::SetupSignIn
        };
        actions = actions.child(
            button(
                ElementId::from(("setup-sign-in", job_id.get() as u64)),
                text(locale, label),
                cx,
            )
            .primary()
            .small()
            .icon(study_ui::icon(IconName::LogIn))
            .disabled(chatgpt.busy)
            .on_click(cx.listener(|this, _, _, cx| {
                this.run_chatgpt_sign_in(false, cx, |_, _, _| {});
            })),
        );
    }
    let settings = button(
        settings_id,
        text(
            locale,
            if sign_in {
                Message::GoToSettings
            } else {
                Message::SetupAction
            },
        ),
        cx,
    )
    .small()
    .icon(study_ui::icon(IconName::Settings))
    .on_click(cx.listener(move |this, _, _, cx| this.open_settings_for(kind, None, cx)));
    actions = actions.child(if sign_in {
        settings.ghost()
    } else {
        settings.primary()
    });
    if job.status.is_stopped() {
        actions = actions.child(
            retry_button(retry_id, job, retry, locale, cx)
                .small()
                .ghost(),
        );
    }

    let disc = unit(40.);
    div()
        .w_full()
        .flex()
        .items_start()
        .gap(unit(scale::SPACE_MD))
        .p(unit(scale::SPACE_LG))
        .rounded(unit(scale::RADIUS_LG))
        .bg(palette.fill)
        .child(
            div()
                .flex_none()
                .size(disc)
                .rounded_full()
                .flex()
                .items_center()
                .justify_center()
                .bg(palette.highlighter_wash)
                .child(
                    Icon::new(icon)
                        .size(unit(20.))
                        .text_color(palette.highlighter_ink),
                ),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(unit(scale::SPACE_XXS))
                .child(
                    div()
                        .text_size(unit(scale::TEXT_TITLE))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(palette.foreground)
                        .child(text(locale, title)),
                )
                .child(
                    div()
                        .text_size(unit(scale::TEXT_SMALL))
                        .text_color(palette.muted)
                        .whitespace_normal()
                        .child(text(locale, body)),
                )
                .when(job.status != JobStatus::Failed, |column| {
                    column.child(
                        div()
                            .text_size(unit(scale::TEXT_CAPTION))
                            .text_color(palette.faint)
                            .child(text(locale, Message::SetupResumes)),
                    )
                })
                .child(actions),
        )
        .into_any_element()
}
