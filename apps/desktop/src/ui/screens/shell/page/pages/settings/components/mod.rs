//! The sections of Settings, one file each, and what their forms share.

use crate::ui::screens::shell::page::pages::components::surface;
use crate::ui::screens::shell::page::*;
use study_app::preferences::Invalid;
use study_ui::{ContentPage, units};

mod general;
mod updates;
pub(in crate::ui::screens::shell::page) use updates::UpdatesState;
mod llm;
mod overview;
mod processing;
mod system;
mod transcription;

pub(in crate::ui::screens::shell::page) use llm::LlmState;
pub(in crate::ui::screens::shell::page) use processing::ProcessingState;
pub(in crate::ui::screens::shell::page) use system::SystemState;
pub(in crate::ui::screens::shell::page) use transcription::TranscriptionState;

/// What a settings form says about text it refused.
fn invalid_message(invalid: Invalid) -> Message {
    match invalid {
        Invalid::Count { .. } => Message::CountError,
    }
}

/// A section whose settings have not loaded: loading, or why not with a way to try again.
/// `notice` is the section's last outcome, and `load_error` what to say without one.
fn unloaded_page(
    page: ContentPage,
    locale: Locale,
    loading: bool,
    notice: Option<(Message, bool)>,
    load_error: Message,
    retry: Button,
) -> ContentPage {
    if loading {
        return page.status(text(locale, Message::LoadingSettings));
    }
    let message = notice.map_or(load_error, |(message, _)| message);
    page.failure(text(locale, message)).item(retry)
}

/// Shows `status`, an outcome and whether it is an error, if there is one.
fn with_status(page: ContentPage, locale: Locale, status: Option<(Message, bool)>) -> ContentPage {
    match status {
        Some((message, true)) => page.failure(text(locale, message)),
        Some((message, false)) => page.status(text(locale, message)),
        None => page,
    }
}

/// A titled group, such as one under a picker for things that go with the choice: a title
/// heading over its rows, set apart by space, with no border.
fn settings_card(title: &'static str, cx: &gpui_kit::App) -> gpui_kit::Div {
    let unit = units(cx);
    surface(cx)
        .gap(unit(study_ui::scale::SPACE_XS))
        .child(study_ui::heading(title, cx))
}

/// One setting: its name and, if any, what it does on the left, its control on the right.
fn setting_row(
    label: impl Into<gpui_kit::SharedString>,
    hint: Option<gpui_kit::SharedString>,
    control: impl IntoElement,
    cx: &gpui_kit::App,
) -> gpui_kit::Div {
    let unit = units(cx);
    div()
        .w_full()
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_LG))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(unit(2.))
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_UI))
                        .child(label.into()),
                )
                .children(hint.map(|hint| {
                    div()
                        .whitespace_normal()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(study_ui::palette(cx).muted)
                        .child(hint)
                })),
        )
        .child(div().flex_none().child(control))
}
