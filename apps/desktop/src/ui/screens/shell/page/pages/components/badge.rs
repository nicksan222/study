//! An icon in a slot, the mark beside a card's title or a row's name: a plain glyph, never
//! a coloured disc or tile (`DESIGN.md`, the No Rainbow Rule).

use gpui_kit::assets::IconName;
use gpui_kit::{App, Div, Hsla, ParentElement as _, Styled as _, div};
use study_ui::units;

/// A slot `size` wide holding `icon` in `tint`, which is the secondary ink (`palette.muted`)
/// for a kind or a place, and `danger` only for what failed. The glyph is 16 wide in a
/// row, 24 in a larger slot such as an empty state's.
pub(in crate::ui::screens::shell::page) fn badge(
    icon: IconName,
    tint: Hsla,
    size: f32,
    cx: &App,
) -> Div {
    let unit = units(cx);
    let glyph = if size >= 48. { 24. } else { 16. };
    div()
        .flex_none()
        .size(unit(size))
        .flex()
        .items_center()
        .justify_center()
        .text_color(tint)
        .child(study_ui::icon(icon).size(unit(glyph)))
}
