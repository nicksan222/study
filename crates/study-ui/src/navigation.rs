//! The window's navigation down its leading edge: labelled destination rows at the top, the
//! page's own [`SectionSidebar`](crate::SectionSidebar) under them, and the utility
//! destinations (Settings, Help) pinned to the foot one under the other, the list fading
//! into the sidebar's tone as it scrolls under them. Labels and glyphs together, as rows; the
//! shell places it in its resizable sidebar (see `workspace.rs`).

use gpui_kit::assets::IconName;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    AnyElement, App, ElementId, InteractiveElement as _, IntoElement, ParentElement as _,
    RenderOnce, SharedString, StatefulInteractiveElement as _, Styled as _, Window, div,
    linear_color_stop, linear_gradient,
};

use crate::MenuItem;

/// A destination row of the navigation: a 16px glyph and its label, selected as a full-width
/// pill. The caller adds the click.
pub fn navigation_row(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    icon: IconName,
    selected: bool,
) -> MenuItem {
    MenuItem::new(id, label).icon(icon).selected(selected)
}

/// The navigation sidebar: main destinations from the top, the page's section under them,
/// utility destinations pinned below.
#[derive(IntoElement, Default)]
pub struct NavigationRail {
    primary: Vec<AnyElement>,
    section: Option<AnyElement>,
    utility: Vec<AnyElement>,
}

impl NavigationRail {
    pub fn new() -> Self {
        Self::default()
    }

    /// A main destination, stacked from the top; usually a [`navigation_row`].
    pub fn primary(mut self, item: impl IntoElement) -> Self {
        self.primary.push(item.into_any_element());
        self
    }

    /// A utility destination such as settings or help, pinned at the bottom beside the others,
    /// sharing one row.
    pub fn utility(mut self, item: impl IntoElement) -> Self {
        self.utility.push(item.into_any_element());
        self
    }

    /// The page's own sidebar, between the destinations and the utility ones. The shell
    /// sets it from the page.
    pub(crate) fn section(mut self, section: Option<AnyElement>) -> Self {
        self.section = section;
        self
    }
}

/// How far the page's list fades into the sidebar's tone above the pinned row, in design
/// pixels.
const FADE: f32 = crate::scale::SPACE_LG;

impl RenderOnce for NavigationRail {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        let palette = crate::palette(cx);
        let primary = div()
            .flex_none()
            .w_full()
            .px(unit(crate::scale::SPACE_XS))
            .flex()
            .flex_col()
            .gap(unit(2.))
            .children(self.primary);
        // Settings and Help pinned one under the other, each a full row, so no label ever
        // breaks or truncates, in any language or at any zoom.
        let utility = div()
            .flex_none()
            .w_full()
            .px(unit(crate::scale::SPACE_XS))
            .flex()
            .flex_col()
            .gap(unit(2.))
            .children(self.utility);
        // The page's section takes the room between the two groups and scrolls itself,
        // fading into the sidebar's tone where it passes under the pinned row; in a window
        // too short for every destination the whole column scrolls, so Settings and Help at
        // its foot stay reachable.
        let middle = match self.section {
            Some(section) => div()
                .relative()
                .flex_1()
                .min_h_0()
                .w_full()
                .mt(unit(crate::scale::SPACE_XS))
                .child(section)
                .child(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .bottom_0()
                        .h(unit(FADE))
                        .bg(linear_gradient(
                            180.,
                            linear_color_stop(palette.sidebar.opacity(0.), 0.),
                            linear_color_stop(palette.sidebar, 1.),
                        )),
                ),
            None => div().flex_1(),
        };
        div()
            .id(crate::ids::NAVIGATION_RAIL_SCROLL)
            .size_full()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .bg(palette.sidebar)
            .text_color(cx.theme().colors.sidebar_foreground)
            .text_size(unit(crate::scale::TEXT_UI))
            .py(unit(crate::scale::SPACE_XS))
            .child(primary)
            .child(middle)
            .child(utility)
    }
}
