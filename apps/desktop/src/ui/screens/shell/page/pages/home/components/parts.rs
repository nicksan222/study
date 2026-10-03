//! What Home is built from, beside the shared `study_ui::Section`: a row and a media tile
//! that click, the one highlighter-filled button, a quiet link to a page, a row's
//! glyph, and quiet or truncated lines.

use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonCustomVariant, ButtonVariants as _},
};
use gpui_kit::{AnyElement, Div, Hsla, SharedString, prelude::FluentBuilder as _};
use study_ui::{button, scaled_px, units};

/// A clickable row: transparent at rest, the hover tone under the pointer, medium radius.
pub(in crate::ui::screens::shell::page::pages::home) fn row_button(
    id: impl Into<gpui_kit::ElementId>,
    label: impl Into<SharedString>,
    cx: &gpui_kit::App,
) -> Button {
    let colors = cx.theme().colors;
    let unit = units(cx);
    Button::new(id)
        .accessibility_label(label.into())
        .tab_stop(true)
        .w_full()
        .h_auto()
        .min_h(unit(32.))
        .p(unit(0.))
        .rounded(unit(study_ui::scale::RADIUS_MD))
        .custom(
            ButtonCustomVariant::new(cx)
                .color(colors.background.opacity(0.))
                .foreground(colors.foreground)
                .hover(colors.secondary_hover)
                .active(colors.secondary_active),
        )
}

/// A clickable media tile: the raised tone, large radius, no border; a step darker under the
/// pointer.
pub(in crate::ui::screens::shell::page::pages::home) fn tile_button(
    id: impl Into<gpui_kit::ElementId>,
    label: impl Into<SharedString>,
    cx: &gpui_kit::App,
) -> Button {
    let colors = cx.theme().colors;
    let unit = units(cx);
    Button::new(id)
        .accessibility_label(label.into())
        .tab_stop(true)
        .h_auto()
        .p(unit(0.))
        .rounded(unit(study_ui::scale::RADIUS_LG))
        .custom(
            ButtonCustomVariant::new(cx)
                .color(colors.background.opacity(0.))
                .foreground(colors.foreground)
                .hover(colors.secondary_hover)
                .active(colors.secondary_active),
        )
}

/// A section's quiet way to the page that holds all of what it shows.
pub(in crate::ui::screens::shell::page::pages::home) fn page_link(
    id: usize,
    label: &'static str,
    page: Page,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    button(id, label, cx)
        .ghost()
        .small()
        .text_color(cx.theme().colors.muted_foreground)
        .on_click(cx.listener(move |this, _, _, cx| {
            this.navigate(page, cx);
        }))
        .into_any_element()
}

/// `icon` as a row's 16px glyph, in the second ink.
pub(in crate::ui::screens::shell::page::pages::home) fn glyph(
    icon: IconName,
    cx: &gpui_kit::App,
) -> Div {
    let unit = units(cx);
    div()
        .flex_none()
        .size(unit(16.))
        .flex()
        .items_center()
        .justify_center()
        .text_color(cx.theme().colors.muted_foreground)
        .child(study_ui::icon(icon).size(unit(16.)))
}

/// One line of `content` at `size`, cut short with an ellipsis when it does not fit.
pub(in crate::ui::screens::shell::page::pages::home) fn ellipsis(
    content: impl Into<SharedString>,
    size: f32,
    color: Option<Hsla>,
    cx: &gpui_kit::App,
) -> Div {
    div()
        .w_full()
        .min_w_0()
        .text_left()
        .text_ellipsis()
        .whitespace_nowrap()
        .text_size(scaled_px(cx, size))
        .when_some(color, |this, color| this.text_color(color))
        .child(content.into())
}

/// A quiet line that says why a section is empty.
pub(in crate::ui::screens::shell::page::pages::home) fn note(
    message: impl Into<SharedString>,
    cx: &gpui_kit::App,
) -> Div {
    div()
        .w_full()
        .text_size(scaled_px(cx, study_ui::scale::TEXT_SMALL))
        .line_height(scaled_px(cx, 18.))
        .text_color(study_ui::palette(cx).faint)
        .whitespace_normal()
        .child(message.into())
}
