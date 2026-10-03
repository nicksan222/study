//! How a page groups its content: a plain column on the canvas, separated from the next by
//! space, never a bordered card (`DESIGN.md`, the Space Not Lines Rule); and the inset an
//! opened fold sits in.

use crate::ui::screens::shell::page::*;
use gpui_kit::Div;
use study_ui::units;

/// A group of content laid out in a column, with no border or fill; the caller sets its
/// size, padding and gap.
pub(in crate::ui::screens::shell::page) fn panel(_: &gpui_kit::App) -> Div {
    div().flex().flex_col()
}

/// A full-width group below the item before it, a group's space away; the caller sets the
/// padding and gap.
pub(in crate::ui::screens::shell::page) fn surface(cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    panel(cx).mt(unit(study_ui::scale::SPACE_LG)).w_full()
}

/// One of a row of groups that share the width and wrap on narrow windows, each saying what
/// one thing is or does; the caller sets the gap.
pub(in crate::ui::screens::shell::page) fn feature_card(cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    panel(cx)
        .flex_1()
        .min_w(unit(280.))
        .py(unit(study_ui::scale::SPACE_XS))
        .gap(unit(study_ui::scale::SPACE_XS))
}

/// The inset an opened fold shows its text in (a transcript, a raw error): a raised tone at
/// medium radius, 16 in from its edge, with no border. It takes the quiet fill, which is the
/// raised tone in dark and a step off the white canvas in light, so it shows in both.
pub(in crate::ui::screens::shell::page) fn inset(cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    div()
        .w_full()
        .p(unit(study_ui::scale::SPACE_MD))
        .flex()
        .flex_col()
        .rounded(unit(study_ui::scale::RADIUS_MD))
        .bg(study_ui::palette(cx).fill)
}
