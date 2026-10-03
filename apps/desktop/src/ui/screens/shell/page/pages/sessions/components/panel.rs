//! How a side panel appears beside the conversation, and the header the shell shows in the
//! title bar above it.

use super::super::ids;
use crate::ui::screens::shell::AppShell;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    Animation, AnimationExt as _, AnyElement, Context, IntoElement, ParentElement as _,
    Styled as _, div, ease_out_quint,
};

/// A side panel's body and the header the title bar shows above it.
pub(in crate::ui::screens::shell::page::pages::sessions) struct Panel {
    pub body: AnyElement,
    pub header: study_ui::PageHeader,
    /// Its width before scaling.
    pub width: f32,
}

/// Reveals `panel`, `width` wide before scaling, from the right edge, titled by `header`.
/// The panel keeps its full width while the wrapper grows, so the conversation beside it
/// narrows smoothly. The animation id is shared by every panel, so switching files or
/// threads does not replay it.
pub(in crate::ui::screens::shell::page::pages::sessions) fn reveal(
    panel: impl IntoElement,
    header: study_ui::PageHeader,
    width: f32,
    cx: &Context<AppShell>,
) -> Panel {
    let scale = study_ui::scaled_px(cx, 1.);
    let body = div()
        .flex_none()
        .h_full()
        .flex()
        .justify_end()
        .overflow_hidden()
        .w(scale * width)
        .child(panel)
        .with_animation(
            ids::DETAIL_MOTION,
            Animation::new(cx.theme().motion.duration_normal).with_easing(ease_out_quint()),
            move |element, progress| element.w(scale * (width * progress)),
        )
        .into_any_element();
    Panel {
        body,
        header,
        width,
    }
}
