//! The window chrome both full windows share: a root painted in the title-bar color, the
//! title bar itself and the size of the app's mark in it, and the rounded surface the
//! content sits in, set apart by tone alone. The windows are
//! [`WorkspaceShell`](crate::WorkspaceShell) (`workspace.rs`) and
//! [`OnboardingFrame`](crate::OnboardingFrame) (`onboarding.rs`).

use gpui_kit::component::{ActiveTheme as _, TitleBar};
use gpui_kit::{App, Div, Styled as _, div};

use crate::theme::unit;

/// Corner radius of the inset content surface, in design pixels.
pub(crate) const INSET_RADIUS: f32 = crate::scale::RADIUS_LG;

/// The app's mark in the title bar, at the title bar's glyph size (`DESIGN.md`, Shapes), in
/// design pixels.
pub(crate) const TITLE_BAR_MARK: f32 = 16.;

/// The window's root: a full-size column in the title-bar color.
pub(crate) fn window_root(cx: &App) -> Div {
    let colors = cx.theme().colors;
    div()
        .size_full()
        .flex()
        .flex_col()
        .bg(colors.title_bar)
        .text_color(colors.foreground)
}

/// The window's title bar, blending into the root with no bottom border.
pub(crate) fn title_bar(cx: &App) -> TitleBar {
    TitleBar::new()
        .h(unit(cx, 46.))
        .bg(cx.theme().colors.title_bar)
        .border_b_0()
}

/// The rounded content surface set into the chrome: the canvas, set apart from the sidebar
/// tone around it with no border. Callers add sizing and children.
pub(crate) fn inset_surface(cx: &App) -> Div {
    let colors = cx.theme().colors;
    div()
        .rounded(unit(cx, INSET_RADIUS))
        .overflow_hidden()
        .bg(colors.background)
}
