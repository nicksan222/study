//! [`EmptyState`]: what a page or a list shows in place of content it doesn't have yet.

use gpui_kit::assets::IconName;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    AnyElement, App, IntoElement, ParentElement as _, RenderOnce, SharedString, Styled as _,
    Window, div, prelude::FluentBuilder as _,
};

use crate::scale;

/// A centred notice in place of content: the page's glyph, one line of why there is nothing
/// (or what failed, in the danger colour) and, when there is one, the way forward. It fills
/// the room it is given and centres in it.
#[derive(IntoElement)]
pub struct EmptyState {
    icon: Option<IconName>,
    message: SharedString,
    failed: bool,
    action: Option<AnyElement>,
}

impl EmptyState {
    pub fn new(message: impl Into<SharedString>) -> Self {
        Self {
            icon: None,
            message: message.into(),
            failed: false,
            action: None,
        }
    }

    /// The glyph above the message, usually the page's own.
    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// Whether the message says what failed, in the danger colour.
    pub fn failed(mut self, failed: bool) -> Self {
        self.failed = failed;
        self
    }

    /// The one way forward, such as Retry, under the message.
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl RenderOnce for EmptyState {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        let colors = cx.theme().colors;
        div()
            .flex_1()
            .size_full()
            .min_h_0()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(unit(scale::SPACE_MD))
            .p(unit(super::PAGE_GUTTER))
            .text_center()
            .text_color(colors.muted_foreground)
            .children(self.icon.map(|icon| {
                crate::icon::icon(icon)
                    .size(unit(36.))
                    .text_color(colors.muted_foreground)
            }))
            .child(
                div()
                    .max_w(unit(420.))
                    .when(self.failed, |line| line.text_color(colors.danger))
                    .child(self.message),
            )
            .children(self.action)
    }
}
