//! A [`PageHeader`] drawn into the title bar: the page's own row, and the contents the side
//! panel's row shares with it.

use gpui_kit::component::{Sizable as _, button::Button};
use gpui_kit::{App, Div, ParentElement as _, Styled as _, div, relative};

use super::PageHeader;
use crate::button::title_bar_sized;
use crate::theme::units;

/// The sizes a [`PageHeader`] is drawn at in the title bar: the page's own, in the title
/// style, or its side panel's, a step smaller and quieter.
pub(crate) struct HeaderScale {
    icon: f32,
    title: f32,
    weight: gpui_kit::FontWeight,
    line_height: f32,
    /// The size of what the page belongs to, beside the title.
    context: f32,
    /// The largest share of the row the title takes before it truncates.
    title_share: f32,
    quiet_icon: bool,
}

impl HeaderScale {
    pub(crate) const PAGE: Self = Self {
        icon: 16.,
        title: crate::scale::TEXT_TITLE,
        weight: gpui_kit::FontWeight::SEMIBOLD,
        line_height: 24.,
        context: crate::scale::TEXT_SMALL,
        title_share: 0.5,
        quiet_icon: false,
    };
    pub(crate) const ASIDE: Self = Self {
        icon: 16.,
        title: crate::scale::TEXT_UI,
        weight: gpui_kit::FontWeight::MEDIUM,
        line_height: 20.,
        context: crate::scale::TEXT_CAPTION,
        title_share: 2. / 3.,
        quiet_icon: true,
    };
}

/// The page's header in the title bar, over the page from its gutter. It gives way first: at
/// high zoom or in a narrow window the title truncates and actions clip before any window
/// control moves.
pub(crate) fn header_row(header: Option<PageHeader>, cx: &App) -> Div {
    let unit = units(cx);
    let row = div()
        .flex_1()
        .min_w_0()
        .overflow_hidden()
        .h_full()
        .flex()
        .items_center()
        .gap(unit(8.))
        .pr(unit(8.));
    match header {
        Some(header) => header_contents(row, header, HeaderScale::PAGE, Vec::new(), cx),
        None => row,
    }
}

/// `header` laid into `row` at `scale`: its icon, ellipsized title and, in faint ink, what
/// it belongs to, then its actions (as the title bar draws them) and `extra` pushed to the
/// end.
pub(crate) fn header_contents(
    row: Div,
    header: PageHeader,
    scale: HeaderScale,
    extra: Vec<Button>,
    cx: &App,
) -> Div {
    let unit = units(cx);
    let palette = crate::theme::palette(cx);
    let muted = palette.muted;
    row.children(header.icon.map(|icon| {
        let icon = crate::icon::icon(icon).with_size(unit(scale.icon));
        if scale.quiet_icon {
            icon.text_color(muted)
        } else {
            icon
        }
    }))
    .child(
        div()
            .min_w_0()
            .max_w(relative(scale.title_share))
            .whitespace_nowrap()
            .text_ellipsis()
            .text_size(unit(scale.title))
            .line_height(unit(scale.line_height))
            .font_weight(scale.weight)
            .child(header.title),
    )
    .children(header.context.map(|text| {
        div()
            .min_w_0()
            .whitespace_nowrap()
            .text_ellipsis()
            .text_size(unit(scale.context))
            .text_color(palette.faint)
            .child(text)
    }))
    .child(div().flex_1())
    .child(
        div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(unit(8.))
            .children(
                header
                    .actions
                    .into_iter()
                    .map(|action| title_bar_sized(action, cx)),
            )
            .children(extra.into_iter().map(|action| title_bar_sized(action, cx))),
    )
}
