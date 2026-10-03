//! A status in a few quiet words: caption text, no fill (`DESIGN.md`, the Quiet Success
//! Rule). Done, running and waiting read in the faint ink; only a failure takes `danger`.

use gpui_kit::{App, Div, Hsla, Styled as _, div};
use study_ui::units;

/// An empty status line in `tint` (`palette.faint`, or `danger` for a failure), for the
/// caller to fill with an icon or a spinner, and words.
pub(in crate::ui::screens::shell::page) fn pill(tint: Hsla, cx: &App) -> Div {
    let unit = units(cx);
    div()
        .flex_none()
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XXS))
        .text_color(tint)
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
}
