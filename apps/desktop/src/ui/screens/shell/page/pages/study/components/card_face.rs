//! The large face of one flashcard, as a deck and a review show it: what it is above, the
//! question in the middle, and the answer below once it is turned, or a quiet line saying
//! how to turn it.

use crate::ui::screens::shell::page::*;
use gpui_kit::{Div, FontWeight, SharedString};
use study_ui::units;

/// How tall the face is at least, in units, so a short question still reads as a card.
const FACE_HEIGHT: f32 = 300.;

/// One card's face, a raised tile: `label` above (its place, or its set), its `front`, and
/// `back` once turned. `prompt` says how to turn it while it is not.
pub(in crate::ui::screens::shell::page::pages::study) fn card_face(
    label: SharedString,
    front: &str,
    back: Option<&str>,
    prompt: Message,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Div {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let top = div()
        .w_full()
        .flex()
        .items_center()
        .justify_between()
        .px(unit(study_ui::scale::SPACE_LG))
        .pt(unit(study_ui::scale::SPACE_MD))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(palette.faint)
        .child(div().min_w_0().text_ellipsis().child(label))
        .child(
            div()
                .flex_none()
                .h(unit(22.))
                .px(unit(study_ui::scale::SPACE_XS))
                .flex()
                .items_center()
                .rounded(unit(study_ui::scale::RADIUS_SM))
                .bg(palette.active)
                .text_color(palette.muted)
                .child(text(locale, Message::CardFront)),
        );
    let question = div()
        .w_full()
        .flex_1()
        .flex()
        .items_center()
        .justify_center()
        .px(unit(40.))
        .py(unit(28.))
        .child(
            div()
                .w_full()
                .min_w_0()
                .text_center()
                .whitespace_normal()
                .text_size(unit(study_ui::scale::TEXT_TITLE))
                .font_weight(FontWeight::SEMIBOLD)
                .line_height(unit(24.))
                .child(SharedString::from(front.to_owned())),
        );
    let foot = match back {
        Some(back) => div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(8.))
            .px(unit(40.))
            .py(unit(study_ui::scale::SPACE_LG))
            .border_t_1()
            .border_color(palette.border)
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(palette.faint)
                    .child(text(locale, Message::CardBack)),
            )
            .child(
                study_ui::body_text(cx)
                    .w_full()
                    .min_w_0()
                    .child(SharedString::from(back.to_owned())),
            ),
        None => div()
            .w_full()
            .flex()
            .items_center()
            .justify_center()
            .gap(unit(study_ui::scale::SPACE_XS))
            .py(unit(study_ui::scale::SPACE_MD))
            .border_t_1()
            .border_color(palette.border)
            .text_size(unit(study_ui::scale::TEXT_SMALL))
            .text_color(palette.faint)
            .child(study_ui::icon(IconName::Eye).size(unit(14.)))
            .child(text(locale, prompt)),
    };
    div()
        .w_full()
        .min_h(unit(FACE_HEIGHT))
        .flex()
        .flex_col()
        .overflow_hidden()
        .rounded(unit(study_ui::scale::RADIUS_LG))
        .border_1()
        .border_color(palette.border)
        .bg(palette.fill)
        .child(top)
        .child(question)
        .child(foot)
}

/// A thin bar `done` of `total` full, in the second ink on the selected tone.
pub(in crate::ui::screens::shell::page::pages::study) fn progress_bar(
    done: usize,
    total: usize,
    cx: &mut Context<AppShell>,
) -> Div {
    let palette = study_ui::palette(cx);
    let unit = units(cx);
    let share = if total == 0 {
        0.
    } else {
        done as f32 / total as f32
    };
    div()
        .w_full()
        .h(unit(4.))
        .rounded(unit(study_ui::scale::RADIUS_FULL))
        .bg(palette.active)
        .child(
            div()
                .h_full()
                .w(gpui_kit::relative(share))
                .rounded(unit(study_ui::scale::RADIUS_FULL))
                .bg(palette.muted),
        )
}
