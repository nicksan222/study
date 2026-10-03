//! Quiet text between a page's items: section headings, lines
//! that explain, and raw text (a failure's error, the start of a file) in a code block.

use super::surface::inset;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{AnyElement, Div, SharedString};
use study_ui::{scaled_px, units};

/// Most lines a code block draws; the rest is reached by copying.
const MAX_LINES: usize = 400;

/// A section's heading ([`study_ui::heading`]) with a group's space above it, for a page
/// that lists its sections as items.
pub(in crate::ui::screens::shell::page) fn section_heading(
    label: &'static str,
    cx: &mut Context<AppShell>,
) -> Div {
    study_ui::heading(label, cx).mt(scaled_px(cx, study_ui::scale::SPACE_LG))
}

/// A muted line that says why something is empty or what to do next.
pub(in crate::ui::screens::shell::page) fn quiet(
    label: &'static str,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    div()
        .mt(scaled_px(cx, study_ui::scale::SPACE_SM))
        .text_color(cx.theme().colors.muted_foreground)
        .whitespace_normal()
        .child(label)
        .into_any_element()
}

/// Raw text, such as a failure's error in whatever words it had: monospace in an opened
/// fold's inset, a row per line like a code viewer.
pub(in crate::ui::screens::shell::page) fn code_block(
    content: &str,
    cx: &gpui_kit::App,
) -> AnyElement {
    let unit = units(cx);
    let rows = content.lines().take(MAX_LINES).map(|line| {
        div()
            .w_full()
            .min_w_0()
            // An empty line keeps its height.
            .min_h(unit(18.))
            .whitespace_normal()
            .child(SharedString::from(line.to_owned()))
    });
    inset(cx)
        .py(unit(study_ui::scale::SPACE_SM))
        .font_family(cx.theme().mono_font_family.clone())
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .line_height(unit(18.))
        .children(rows)
        .into_any_element()
}
