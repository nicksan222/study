//! A file's kind as a monochrome glyph in secondary ink, so a list of files reads at a
//! glance without a colour per kind (`DESIGN.md`, the No Rainbow Rule).

use crate::features::media::KindStyle as _;
use gpui_kit::{App, Div, ParentElement as _, Styled as _, div};
use study_core::SourceKind;

/// The slot `size` wide that a source's kind glyph is centred in: 16 wide beside a row's
/// name, 24 where it stands in for a preview that has none.
pub(in crate::ui::screens::shell::page) fn file_tile(kind: SourceKind, size: f32, cx: &App) -> Div {
    let unit = study_ui::units(cx);
    let glyph = if size >= 56. { 24. } else { 16. };
    div()
        .flex_none()
        .size(unit(size))
        .flex()
        .items_center()
        .justify_center()
        .text_color(study_ui::palette(cx).muted)
        .child(study_ui::icon(kind.icon()).size(unit(glyph)))
}
