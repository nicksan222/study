//! Shared native button sizing; color/state variants remain GPUI Kit's API, plus the one
//! the theme has no token for, the highlighter. Every button size the crate uses is here:
//! [`button`], [`highlighter_button`], [`icon_button`], and the sizes a button takes in the
//! title bar and the composer.

use gpui_kit::assets::IconName;
use gpui_kit::component::{
    Sizable as _,
    button::{Button, ButtonCustomVariant, ButtonVariants as _},
};
use gpui_kit::{App, ElementId, SharedString, Styled as _};

/// A labelled button at the standard size: 32 tall, medium radius, UI text. As it comes it
/// is the quiet button (the hover tone, ink text, no border); `.primary()` fills it with
/// ink for the main action of a view, and `.ghost()` or `.danger()` as GPUI Kit draws them.
/// The learning action is a [`highlighter_button`] instead.
pub fn button(id: impl Into<ElementId>, label: impl Into<SharedString>, cx: &App) -> Button {
    let unit = crate::theme::units(cx);
    Button::new(id)
        .label(label)
        .rounded(unit(crate::scale::RADIUS_MD))
        .h(unit(32.))
        .px(unit(crate::scale::SPACE_SM))
        .text_size(unit(crate::scale::TEXT_UI))
        .tab_stop(true)
}

/// The learning action of a screen, such as "Review now" or "Start practice": a
/// [`button`] filled with the highlighter, its words in the ink made for it. It is GPUI
/// Kit's warning variant, whose tokens the theme fills with the highlighter (a custom
/// variant would mix its fill toward transparent). Pages that switch a button between this
/// and another look call `.warning()` on it themselves. Use at most one
/// on a screen (`DESIGN.md`, the One Highlighter Rule); every other action is a plain or
/// primary [`button`].
pub fn highlighter_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    cx: &App,
) -> Button {
    let unit = crate::theme::units(cx);
    button(id, label, cx).px(unit(14.)).warning()
}

/// Draws a caller's button the way the title bar holds every control (`DESIGN.md`,
/// Layout): 28 tall, transparent, its glyph and words in ink 2, the hover tone under the
/// pointer, medium radius. Whatever look the caller gave it gives way, so no page puts a
/// filled button in the title bar.
pub(crate) fn title_bar_sized(button: Button, cx: &App) -> Button {
    let unit = crate::theme::units(cx);
    quiet(button, cx)
        .h(unit(28.))
        .text_size(unit(crate::scale::TEXT_SMALL))
}
/// Resizes the caller's submit button to a round button that sits in the composer's footer.
pub(crate) fn composer_submit_sized(button: Button, cx: &App) -> Button {
    let unit = crate::theme::units(cx);
    button
        .rounded(unit(crate::scale::RADIUS_XL))
        .w(unit(32.))
        .h(unit(32.))
}

/// The look of an icon button: transparent, the glyph in ink 2, the hover tone under the
/// pointer and the selected tone pressed or toggled.
fn quiet(button: Button, cx: &App) -> Button {
    let palette = crate::theme::palette(cx);
    button.custom(
        ButtonCustomVariant::new(cx)
            .foreground(palette.muted)
            .hover(palette.hover)
            .active(palette.active),
    )
}

/// The size GPUI Kit draws a button's glyph at is three quarters of the button's size; this
/// is the size that gives the 16px glyph (`DESIGN.md`, Shapes).
const ICON_GLYPH: f32 = 16. / 0.75;

/// An icon-only control (`DESIGN.md`, Icon buttons): 28 square, transparent, a 16px glyph in
/// ink 2 and the hover tone under the pointer. It always carries a tooltip and an
/// accessible name.
pub fn icon_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    icon: IconName,
    cx: &App,
) -> Button {
    let unit = crate::theme::units(cx);
    let label = label.into();
    quiet(
        Button::new(id)
            .icon(crate::icon::icon(icon))
            .accessibility_label(label.clone())
            .tooltip(label),
        cx,
    )
    .with_size(unit(ICON_GLYPH))
    .rounded(unit(crate::scale::RADIUS_MD))
    .w(unit(28.))
    .h(unit(28.))
    .tab_stop(true)
}
