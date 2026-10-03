//! The background every page's body fills, inside the shell's inset surface.

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    AnyElement, App, IntoElement, ParentElement as _, RenderOnce, Styled as _, Window, div,
};

/// A page's background and text color, filling the inset surface the shell draws (see
/// `chrome.rs`). The shell also draws the page's header in the title bar; pages supply only
/// their body.
#[derive(IntoElement)]
pub struct PageFrame {
    body: AnyElement,
}

impl PageFrame {
    pub fn new(body: impl IntoElement) -> Self {
        Self {
            body: body.into_any_element(),
        }
    }
}

impl RenderOnce for PageFrame {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors;
        div()
            .size_full()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(colors.background)
            .text_color(colors.foreground)
            .child(self.body)
    }
}
