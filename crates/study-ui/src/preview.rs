//! A visual appearance sample, independent of selection state or persistence.

use gpui_kit::assets::IconName;
use gpui_kit::component::{Sizable as _, ThemeMode};
use gpui_kit::{App, IntoElement, ParentElement as _, RenderOnce, Styled as _, Window, div};

/// A miniature window in the given appearance, for appearance pickers such as a
/// [`ChoiceCard`](crate::ChoiceCard) visual.
#[derive(IntoElement)]
pub struct ThemePreview {
    appearance: ThemeMode,
}

impl ThemePreview {
    pub fn new(appearance: ThemeMode) -> Self {
        Self { appearance }
    }
}

impl RenderOnce for ThemePreview {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        let palette = crate::theme::Palette::of(self.appearance);
        let dark = self.appearance == ThemeMode::Dark;
        div()
            .w(unit(64.))
            .h(unit(40.))
            .flex_shrink_0()
            .rounded(unit(crate::scale::RADIUS_MD))
            .overflow_hidden()
            .p(unit(4.))
            .flex()
            .gap(unit(4.))
            .bg(palette.title_bar)
            .child(
                div()
                    .w(unit(17.))
                    .flex()
                    .flex_col()
                    .gap(unit(4.))
                    .pt(unit(3.))
                    .child(
                        div()
                            .h(unit(4.))
                            .rounded(unit(crate::scale::RADIUS_SM))
                            .bg(palette.muted),
                    )
                    .child(
                        div()
                            .h(unit(4.))
                            .rounded(unit(crate::scale::RADIUS_SM))
                            .bg(palette.active),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .h_full()
                    .rounded(unit(crate::scale::RADIUS_SM))
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(palette.background)
                    .text_color(palette.foreground)
                    .child(
                        crate::icon::icon(if dark { IconName::Moon } else { IconName::Sun })
                            .with_size(unit(18.)),
                    ),
            )
    }
}
