//! The page-owned section sidebar: a titled, scrolling list of rows (usually
//! [`MenuItem`](crate::MenuItem)s or a [`ProjectGroup`](crate::ProjectGroup) tree) with
//! header actions and a footer. The shell places it; see `workspace.rs`.

use gpui_kit::component::{ActiveTheme as _, button::Button};
use std::time::Duration;

use gpui_kit::{
    AnyElement, App, InteractiveElement as _, IntoElement, ParentElement as _, RenderOnce,
    SharedString, StatefulInteractiveElement as _, Styled as _, Window, div,
};

use crate::{Rise, ids};

/// How long after the row above each row starts its entrance, and the row from which the
/// rest start together, so a long list is whole in well under half a second.
const ROW_STAGGER: Duration = Duration::from_millis(22);
const STAGGERED_ROWS: usize = 10;

/// Secondary navigation; width is owned by the shell's resizable panel.
#[derive(IntoElement)]
pub struct SectionSidebar {
    title: Option<SharedString>,
    items: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    footer: Vec<AnyElement>,
}

impl SectionSidebar {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: Some(title.into()),
            ..Self::untitled()
        }
    }

    /// A sidebar with no label of its own, for a list whose groups carry their own labels
    /// right at its top (as Settings' do), where one more would only stack labels.
    pub fn untitled() -> Self {
        Self {
            title: None,
            items: Vec::new(),
            actions: Vec::new(),
            footer: Vec::new(),
        }
    }

    /// A control beside the title.
    pub fn action(mut self, action: Button) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    /// Pinned below the scrolling items.
    pub fn footer(mut self, footer: impl IntoElement) -> Self {
        self.footer.push(footer.into_any_element());
        self
    }

    /// Adds a row to the scrolling list.
    pub fn item(mut self, item: impl IntoElement) -> Self {
        self.items.push(item.into_any_element());
        self
    }
}

impl RenderOnce for SectionSidebar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        // The rows rise in one after another when the sidebar mounts: on a new page, or when
        // one appears. Each keeps its ID by place, so a row that stays never moves again.
        let enter = |index: usize, row: AnyElement| {
            Rise::new(ids::sidebar_row_motion(index), row)
                .delay(ROW_STAGGER * index.min(STAGGERED_ROWS) as u32)
                .travel(crate::scale::SPACE_XS)
        };
        // Under the navigation, which already names the page: a quiet section label and the
        // page's actions, when there are either.
        let label = (self.title.is_some() || !self.actions.is_empty()).then(|| {
            div()
                .flex_shrink_0()
                .h(unit(28.))
                .pl(unit(8.))
                .flex()
                .items_center()
                .gap(unit(8.))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_ellipsis()
                        .text_size(unit(crate::scale::TEXT_CAPTION))
                        .font_weight(gpui_kit::FontWeight::MEDIUM)
                        .text_color(crate::theme::palette(cx).faint)
                        .children(self.title),
                )
                .children(self.actions)
        });
        let label = label.map(|label| enter(0, label.into_any_element()));
        let items = self
            .items
            .into_iter()
            .enumerate()
            .map(|(index, item)| enter(index + 1, item));
        div()
            .size_full()
            .bg(cx.theme().sidebar)
            .text_color(cx.theme().sidebar_foreground)
            .px(unit(8.))
            .py(unit(8.))
            .flex()
            .flex_col()
            .gap(unit(12.))
            .children(label)
            .child(
                div()
                    .id(ids::SIDEBAR_ITEMS_SCROLL)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(unit(2.))
                    // Room to scroll the last row clear of the fade under it (see
                    // `navigation.rs`).
                    .pb(unit(crate::scale::SPACE_MD))
                    .children(items),
            )
            .children(self.footer)
    }
}
