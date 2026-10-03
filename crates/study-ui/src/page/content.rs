//! A titled page of caller-owned items, as a settings-style document or a
//! list-first workspace.

use gpui_kit::assets::IconName;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, button::Button};
use gpui_kit::{
    AnyElement, App, Div, InteractiveElement as _, IntoElement, ParentElement, RenderOnce,
    SharedString, Styled as _, Window, div,
};

use super::{PageFrame, PageHeader, PageIntro};
use crate::ids;

/// A titled content page with a description and a vertical stack of caller-owned items. The
/// title goes to the title bar; the description opens the body as a [`PageIntro::lead`],
/// since the title bar carries none (`DESIGN.md`, Layout), unless the page gives an
/// [`intro`](Self::intro) of its own.
#[derive(IntoElement)]
pub struct ContentPage {
    title: SharedString,
    icon: IconName,
    /// Boxed: the page travels by value inside `PageView`.
    intro: Option<Box<PageIntro>>,
    items: Vec<AnyElement>,
    status: Option<SharedString>,
    failure: Option<SharedString>,
    workspace: bool,
    empty: Option<SharedString>,
    actions: Vec<Button>,
    footer_actions: Vec<Button>,
}

impl ContentPage {
    pub fn new(title: impl Into<SharedString>, description: impl Into<SharedString>) -> Self {
        let description: SharedString = description.into();
        Self {
            title: title.into(),
            intro: (!description.is_empty()).then(|| Box::new(PageIntro::lead(description))),
            icon: IconName::Settings,
            items: Vec::new(),
            status: None,
            failure: None,
            workspace: false,
            empty: None,
            actions: Vec::new(),
            footer_actions: Vec::new(),
        }
    }

    /// The heading icon, also used by the empty state. Defaults to settings.
    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = icon;
        self
    }

    /// What opens the body in place of the description, such as the title and facts of
    /// what the page shows. [`scale::SPACE_LG`](crate::scale::SPACE_LG) separates it from
    /// the items.
    pub fn intro(mut self, intro: PageIntro) -> Self {
        self.intro = Some(Box::new(intro));
        self
    }

    /// Adds an item to the page body, below any added before it.
    pub fn item(mut self, item: impl IntoElement) -> Self {
        self.items.push(item.into_any_element());
        self
    }

    /// A quieter, list-first layout for the main project and media workspaces.
    pub fn workspace(mut self) -> Self {
        self.workspace = true;
        self
    }

    /// Shown centered, with the page icon, when there is nothing to list.
    pub fn empty(mut self, message: impl Into<SharedString>) -> Self {
        self.empty = Some(message.into());
        self
    }

    /// Compact actions alongside the workspace heading.
    pub fn action(mut self, action: Button) -> Self {
        self.actions.push(action);
        self
    }

    /// Form actions are grouped horizontally after the fields.
    pub fn footer_action(mut self, action: Button) -> Self {
        self.footer_actions.push(action);
        self
    }

    /// A one-line neutral outcome after the items, such as "Saved".
    pub fn status(mut self, message: impl Into<SharedString>) -> Self {
        self.status = Some(message.into());
        self
    }

    /// What went wrong, in the danger color, after the items.
    pub fn failure(mut self, message: impl Into<SharedString>) -> Self {
        self.failure = Some(message.into());
        self
    }
}

impl RenderOnce for ContentPage {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        // Standalone, the header sits above the body as the shell's title bar draws it; in
        // the shell, `PageView` hoists it into the title bar instead.
        let unit = crate::theme::units(cx);
        let (header, body) = self.split(cx);
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                super::header_row(Some(header), cx)
                    .flex_none()
                    .h(unit(52.))
                    .px(unit(super::PAGE_GUTTER)),
            )
            .child(body)
    }
}

impl ContentPage {
    /// Separates the heading (title, icon, actions) from the scrolling body.
    pub(crate) fn split(self, cx: &App) -> (PageHeader, AnyElement) {
        let mut header = PageHeader::new(self.title).icon(self.icon);
        for button in self.actions {
            header = header.action(button);
        }
        let tail = Tail::new(
            self.footer_actions,
            self.status,
            self.failure,
            self.empty,
            self.icon,
            cx,
        );
        let unit = crate::theme::units(cx);
        let intro = self
            .intro
            .map(|intro| (*intro).mb(unit(crate::scale::SPACE_LG)));
        let body = if self.workspace {
            workspace_body(intro, self.items, tail, cx).into_any_element()
        } else {
            document_body(intro, self.items, tail, cx).into_any_element()
        };
        (header, PageFrame::new(body).into_any_element())
    }
}

/// The list-first layout: a scrolling, full-width list of items.
fn workspace_body(intro: Option<PageIntro>, items: Vec<AnyElement>, tail: Tail, cx: &App) -> Div {
    let unit = crate::theme::units(cx);
    let items = div()
        .w_full()
        .flex()
        .flex_col()
        .items_start()
        .gap(unit(14.))
        .children(items);
    let body = super::page_scroll(ids::CONTENT_BODY_SCROLL, cx).child(
        tail.append_to(
            super::page_column(super::Column::Page)
                .flex()
                .flex_col()
                .children(intro)
                .child(items),
        ),
    );

    div()
        .flex_1()
        .min_h_0()
        .w_full()
        .flex()
        .flex_col()
        .child(body)
}

/// The document layout: a scrolling, readable-width column of items.
fn document_body(
    intro: Option<PageIntro>,
    items: Vec<AnyElement>,
    tail: Tail,
    cx: &App,
) -> impl IntoElement {
    let unit = crate::theme::units(cx);
    let items = div().flex().flex_col().gap(unit(6.)).children(items);
    let column = tail.append_to(
        super::page_column(super::Column::Page)
            .flex()
            .flex_col()
            .children(intro)
            .child(items),
    );

    super::page_scroll(ids::CONTENT_BODY_SCROLL, cx).child(column)
}

/// The trailing rows shared by both layouts: footer actions, status, failure, and the
/// empty state, in that order.
struct Tail {
    footer: Option<Div>,
    status: Option<Div>,
    failure: Option<Div>,
    empty: Option<Div>,
}

impl Tail {
    fn new(
        footer_actions: Vec<Button>,
        status: Option<SharedString>,
        failure: Option<SharedString>,
        empty: Option<SharedString>,
        icon: IconName,
        cx: &App,
    ) -> Self {
        let unit = crate::theme::units(cx);
        let colors = cx.theme().colors;
        Self {
            footer: (!footer_actions.is_empty()).then(|| {
                div()
                    .mt(unit(24.))
                    .flex()
                    .flex_wrap()
                    .gap(unit(8.))
                    .children(footer_actions)
            }),
            status: status.map(|message| {
                div()
                    .mt(unit(18.))
                    .text_color(colors.muted_foreground)
                    .child(message)
            }),
            failure: failure.map(|message| {
                div().mt(unit(18.)).child(
                    div()
                        .id(ids::CONTENT_FAILURE)
                        .test_support()
                        .text_color(colors.danger)
                        .child(message),
                )
            }),
            empty: empty.map(|message| {
                div()
                    .flex_1()
                    .min_h(unit(240.))
                    .w_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(unit(crate::scale::SPACE_MD))
                    .p(unit(crate::scale::SPACE_XL))
                    .text_center()
                    .text_size(unit(crate::scale::TEXT_BODY))
                    .text_color(colors.muted_foreground)
                    .child(crate::icon::icon(icon).with_size(unit(24.)))
                    .child(div().max_w(unit(360.)).child(message))
            }),
        }
    }

    fn append_to<E: ParentElement>(self, parent: E) -> E {
        parent
            .children(self.footer)
            .children(self.status)
            .children(self.failure)
            .children(self.empty)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::component::ThemeMode;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AppContext as _, Context, Render, TestAppContext, WindowOptions, px};

    const ITEM: usize = 10;

    struct FailedPage;

    impl Render for FailedPage {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            ContentPage::new("Library", "")
                .item(div().id(ITEM).test_support().h(px(40.)).child("A file"))
                .failure("Could not load the library.")
        }
    }

    /// A failure follows the items.
    #[gpui_kit::test]
    fn a_failure_follows_the_items(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(|cx| crate::configure_theme(cx, ThemeMode::Light));
        let (window, _) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| cx.new(|_| FailedPage))
                .unwrap()
        });
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            let item = window.find(ITEM).bounds();
            let message = window.find(ids::CONTENT_FAILURE).bounds();
            assert!(message.top() >= item.bottom(), "{item:?} {message:?}");
        })
        .unwrap();
    }
}
