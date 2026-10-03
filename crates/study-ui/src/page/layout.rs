//! Where a page's content sits and how it is grouped, so no page sets its own gutter,
//! column, spacing or heading type: the scrolling body ([`page_scroll`]), the column in it
//! ([`page_column`]), the stack of sections ([`page_sections`]) and each section's heading
//! ([`heading`], [`Section`]). `DESIGN.md`, Layout, says why each is what it is.

use gpui_kit::{
    AnyElement, App, Div, ElementId, FontWeight, InteractiveElement as _, IntoElement,
    ParentElement, RenderOnce, SharedString, Stateful, StatefulInteractiveElement as _,
    StyleRefinement, Styled, Window, div,
};

use crate::scale;

/// The inset, in design pixels, from the page's leading edge to its content and heading.
/// The title in the title bar starts on it too, so a page's content starts under its title.
pub const PAGE_GUTTER: f32 = 28.;

/// The two widths a page's column comes in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Column {
    /// What is read: the notebook, study material, a review, a quiz, Help.
    Read,
    /// Rows, tiles, fields and drawings: Home, Library, Activity, Settings, overviews.
    Page,
}

impl Column {
    /// The column's widest, in design pixels.
    pub fn width(self) -> f32 {
        match self {
            Self::Read => scale::COLUMN_READ,
            Self::Page => scale::COLUMN_PAGE,
        }
    }
}

/// A page's column, at most `column`'s width, in the page frame every page shares: the
/// frame is the page width, centred on the canvas, and the column starts on its left edge.
/// So the content sits in the middle of a wide window, and its first letter is in the same
/// place on every page; a reading column just stops sooner. Put it inside [`page_scroll`],
/// which keeps the gutter when the canvas is narrower than the frame.
pub fn page_column(column: Column) -> PageColumn {
    PageColumn {
        frame: div(),
        base: div(),
        width: column.width(),
    }
}

/// [`page_column`]: styles and children go to the column; the frame around it centres it.
#[derive(IntoElement)]
pub struct PageColumn {
    frame: Div,
    base: Div,
    width: f32,
}

impl PageColumn {
    /// A column of its own width, in design pixels, in place of a [`Column`]'s, such as
    /// the notebook's, whose margin for times and actions reaches past the reading width.
    pub fn width(mut self, width: f32) -> Self {
        self.width = width;
        self
    }

    /// The gutter around the frame, for a body that is not inside [`page_scroll`].
    pub fn gutter(mut self, cx: &App) -> Self {
        self.frame = self.frame.px(crate::theme::unit(cx, PAGE_GUTTER));
        self
    }
}

impl Styled for PageColumn {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl ParentElement for PageColumn {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.base.extend(elements);
    }
}

impl RenderOnce for PageColumn {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        self.frame.w_full().flex().justify_center().child(
            div()
                .w_full()
                .max_w(unit(scale::COLUMN_PAGE))
                .child(self.base.w_full().max_w(unit(self.width))),
        )
    }
}

/// A page's scrolling body: the whole canvas, its content inset by [`PAGE_GUTTER`] at the
/// sides, 32px above and 48px below. `id` keeps the page's scroll position.
pub fn page_scroll(id: impl Into<ElementId>, cx: &App) -> Stateful<Div> {
    let unit = crate::theme::units(cx);
    div()
        .id(id)
        .size_full()
        .flex_1()
        .min_h_0()
        .min_w_0()
        .overflow_y_scroll()
        .px(unit(PAGE_GUTTER))
        .pt(unit(scale::SPACE_XL))
        .pb(unit(scale::SPACE_XXL))
}

/// A page's sections one under another, 48px apart.
pub fn page_sections(cx: &App) -> Div {
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(crate::theme::unit(cx, scale::SPACE_XXL))
}

/// A section's heading on its own: title size, semibold, on a 24px line.
pub fn heading(label: impl Into<SharedString>, cx: &App) -> Div {
    let unit = crate::theme::units(cx);
    div()
        .min_w_0()
        .text_size(unit(scale::TEXT_TITLE))
        .line_height(unit(24.))
        .font_weight(FontWeight::SEMIBOLD)
        .child(label.into())
}

/// A section: its [`heading`], with how many items it holds and an action when it has them,
/// over its content, 8px apart. Full width; style it to size it otherwise.
#[derive(IntoElement)]
pub struct Section {
    base: Div,
    title: SharedString,
    count: Option<usize>,
    action: Option<AnyElement>,
    content: Vec<AnyElement>,
}

impl Section {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            base: div().w_full(),
            title: title.into(),
            count: None,
            action: None,
            content: Vec::new(),
        }
    }

    /// How many items the section holds, after its title, such as "Sources 8".
    pub fn count(mut self, count: usize) -> Self {
        self.count = Some(count);
        self
    }

    /// A control at the heading's trailing end, such as "Open library".
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl Styled for Section {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl ParentElement for Section {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.content.extend(elements);
    }
}

impl RenderOnce for Section {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        // GPUI lays text out without baselines, so the title and its count sit on their
        // bottom edges with line heights whose space below the baseline matches: 24 for the
        // 17px title and 20 for the 12px count leave about 6px each.
        let count = self.count.map(|count| {
            div()
                .flex_none()
                .text_size(unit(scale::TEXT_CAPTION))
                .line_height(unit(20.))
                .text_color(crate::theme::palette(cx).faint)
                .child(count.to_string())
        });
        let title = div()
            .flex_1()
            .min_w_0()
            .flex()
            .items_end()
            .gap(unit(scale::SPACE_XS))
            .child(heading(self.title, cx))
            .children(count);
        self.base
            .flex()
            .flex_col()
            .gap(unit(scale::SPACE_XS))
            .child(
                div()
                    .w_full()
                    .min_h(unit(28.))
                    .flex()
                    .items_center()
                    .gap(unit(scale::SPACE_XS))
                    .child(title)
                    .children(self.action),
            )
            .children(self.content)
    }
}

/// A paragraph of reading text: body size on the 24px reading line, wrapping. Colour and
/// width are the caller's.
pub fn body_text(cx: &App) -> Div {
    let unit = crate::theme::units(cx);
    div()
        .whitespace_normal()
        .text_size(unit(scale::TEXT_BODY))
        .line_height(unit(24.))
}
