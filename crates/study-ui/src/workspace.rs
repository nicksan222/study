//! The main window: title bar (menu, toolbar, the page's header), then the sidebar (the
//! [`NavigationRail`]'s destinations with the page's section sidebar between them) beside the
//! inset canvas holding the page. Application chrome and resizing belong to the design
//! system, not feature screens. Shared chrome pieces are in `chrome.rs`;
//! what a page hands the shell is [`PageView`] in `page/view.rs`, and how its header is drawn
//! is in `page/header.rs`.

use std::rc::Rc;

use gpui_kit::base::{ResizeHandleContext, ResizeHandleState};
use gpui_kit::component::resizable::resize_handle_appearance;
use gpui_kit::component::{ActiveTheme as _, button::Button, h_resizable, resizable_panel};
use gpui_kit::{
    Animation, AnimationExt as _, AnyElement, App, Bounds, Div, ElementId, Entity, IntoElement,
    ParentElement as _, Pixels, RenderOnce, Styled as _, Window, canvas, div, ease_out_quint, px,
};

use crate::button::title_bar_sized;
use crate::chrome::{INSET_RADIUS, inset_surface, title_bar, window_root};
use crate::motion::FadeIn;
use crate::page::{
    ASIDE_GUTTER, HeaderScale, PAGE_GUTTER, PageHeader, header_contents, header_row,
};
use crate::theme::units;
use crate::{NavigationRail, PageView, RoundedClip, SectionSidebar, ids};

/// The main application window around the current page.
#[derive(IntoElement)]
pub struct WorkspaceShell {
    rail: NavigationRail,
    sidebar: Option<AnyElement>,
    page: PageView,
    page_key: ElementId,
    sidebar_key: Option<ElementId>,
    menu: Option<AnyElement>,
    toolbar: Vec<Button>,
    toolbar_end: Vec<Button>,
    sidebar_visible: bool,
}

impl WorkspaceShell {
    /// `rail` holds the window's destinations; `sidebar` is the page's own list, shown
    /// between them.
    pub fn new(
        rail: NavigationRail,
        sidebar: Option<SectionSidebar>,
        page: impl Into<PageView>,
    ) -> Self {
        Self {
            rail,
            sidebar: sidebar.map(IntoElement::into_any_element),
            page: page.into(),
            page_key: ids::SHELL_DEFAULT_PAGE_KEY.into(),
            sidebar_key: None,
            menu: None,
            toolbar: Vec::new(),
            toolbar_end: Vec::new(),
            sidebar_visible: true,
        }
    }

    /// Stable identity keeps rerenders still and animates a newly selected page; a new key
    /// also gives the page and its sidebar fresh state, such as their scroll positions.
    pub fn page_key(mut self, key: impl Into<ElementId>) -> Self {
        self.page_key = key.into();
        self
    }

    /// The sidebar's own key, when it should replay its entrance less often than the page,
    /// such as not on every choice made inside it. The page key by default.
    pub fn sidebar_key(mut self, key: impl Into<ElementId>) -> Self {
        self.sidebar_key = Some(key.into());
        self
    }

    /// The in-window application menu. Ignored on macOS, which uses the system menu
    /// installed by the application.
    pub fn menu(mut self, menu: impl IntoElement) -> Self {
        self.menu = cfg!(not(target_os = "macos")).then(|| menu.into_any_element());
        self
    }

    /// A control in the title bar, after the menu and before the page header.
    pub fn toolbar_action(mut self, action: Button) -> Self {
        self.toolbar.push(action);
        self
    }

    /// A control at the trailing edge of the title bar.
    pub fn toolbar_end_action(mut self, action: Button) -> Self {
        self.toolbar_end.push(action);
        self
    }

    /// Whether the sidebar shows at all: hidden, the canvas takes the whole window.
    pub fn sidebar_visible(mut self, visible: bool) -> Self {
        self.sidebar_visible = visible;
        self
    }
}

/// Where the title bar's row and the page last laid out, in window coordinates. The title
/// bar lines its columns up with the page from it, so the page's title sits over the page
/// whatever the sidebar's width, the zoom or the platform's title bar padding.
#[derive(Clone, Copy, Default)]
struct Geometry {
    row: Bounds<Pixels>,
    page: Bounds<Pixels>,
}

impl RenderOnce for WorkspaceShell {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = units(cx);
        let geometry = window.use_keyed_state(ids::SHELL_GEOMETRY, cx, |_, _| Geometry::default());
        let (header, aside, page) = self.page.resolve(cx);
        let page = div()
            .relative()
            .size_full()
            .child(FadeIn::new(self.page_key.clone(), page))
            .child(measure(geometry.clone(), |geometry| &mut geometry.page))
            .into_any_element();
        let sidebar_key = self.sidebar_key.unwrap_or_else(|| self.page_key.clone());
        let section = self.sidebar.map(|section| {
            FadeIn::new(ids::shell_sidebar(&sidebar_key), section).into_any_element()
        });
        let sidebar = self
            .sidebar_visible
            .then(|| self.rail.section(section).into_any_element());
        let toolbar = self
            .toolbar
            .into_iter()
            .map(|button| title_bar_sized(button, cx));
        let toolbar_end = self
            .toolbar_end
            .into_iter()
            .map(|button| title_bar_sized(button.flex_none(), cx))
            .collect::<Vec<_>>();
        let Geometry { row, page: bounds } = *geometry.read(cx);
        // The page's leading edge and, with a panel open, the panel's, from the row's start.
        let page_start = bounds.left() - row.left();
        let aside = aside.map(|aside| {
            let start = bounds.right() - unit(aside.width) - row.left();
            (aside.header, (row.size.width - start).max(px(0.)))
        });

        // The navigation controls fill the columns left of the page, so the page's title
        // starts at the page's gutter; if they need more room, the title follows them.
        let controls = div()
            .flex_none()
            .h_full()
            .min_w(page_start + unit(PAGE_GUTTER))
            .flex()
            .items_center()
            .gap(unit(8.))
            .px(unit(8.))
            .children(
                self.menu
                    .map(|menu| div().w(unit(120.)).h_full().flex_none().child(menu)),
            )
            .children(toolbar);
        let header = header_row(header, cx);
        let trailing = match aside {
            Some((aside, width)) => aside_row(aside, width, toolbar_end, cx),
            None => div()
                .flex_none()
                .h_full()
                .flex()
                .items_center()
                .gap(unit(8.))
                .pr(unit(8.))
                .children(toolbar_end),
        };

        window_root(cx)
            .child(title_bar_row(geometry, [controls, header, trailing], cx))
            .child(body(sidebar, page, window, cx))
    }
}

/// The title bar holding `columns` side by side, measured into `geometry`'s row.
fn title_bar_row(geometry: Entity<Geometry>, columns: [Div; 3], cx: &App) -> impl IntoElement {
    title_bar(cx).child(
        // The title bar grows to fit its content's minimum width, which at high zoom would
        // push the window controls off-screen. Laid out absolutely inside a flexible slot,
        // the row adds nothing to that minimum and instead gives way (the page header
        // truncates first).
        div()
            .h_full()
            .flex_1()
            .min_w_0()
            .relative()
            .child(measure(geometry, |geometry| &mut geometry.row))
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full()
                    .flex()
                    .items_center()
                    .children(columns),
            ),
    )
}

/// Everything under the title bar: the sidebar, when it shows, beside the inset canvas
/// holding `page`.
fn body(sidebar: Option<AnyElement>, page: AnyElement, window: &Window, cx: &App) -> Div {
    let unit = units(cx);
    let canvas = inset_surface(cx).size_full().child(RoundedClip::new(
        unit(INSET_RADIUS),
        cx.theme().colors.title_bar,
        page,
    ));
    let body = div().flex_1().min_h_0().flex().pr(unit(4.)).pb(unit(4.));
    match sidebar {
        Some(sidebar) => body.child(sidebar_and_canvas(sidebar, canvas, window, cx)),
        None => body.pl(unit(4.)).child(canvas),
    }
}

/// Records the bounds its parent laid out at into `geometry`, drawing nothing. A change
/// draws the window once more, so the title bar lines up a frame after a move.
fn measure(
    geometry: Entity<Geometry>,
    part: fn(&mut Geometry) -> &mut Bounds<Pixels>,
) -> impl IntoElement {
    canvas(
        move |bounds, window, cx| {
            geometry.update(cx, |geometry, _| {
                let recorded = part(geometry);
                if *recorded != bounds {
                    *recorded = bounds;
                    window.request_animation_frame();
                }
            });
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// The side panel's header in the title bar, `width` wide over the panel, behind a line that
/// continues the panel's border and slides in with it. The trailing toolbar ends it.
fn aside_row(header: PageHeader, width: Pixels, toolbar_end: Vec<Button>, cx: &App) -> Div {
    let unit = units(cx);
    let divider = div()
        .absolute()
        .top_0()
        .bottom_0()
        .left_0()
        .w(px(1.))
        .bg(cx.theme().colors.border)
        .with_animation(
            ids::SHELL_ASIDE_MOTION,
            Animation::new(cx.theme().motion.duration_normal).with_easing(ease_out_quint()),
            move |line, progress| line.left(width * (1. - progress)),
        );
    let row = div()
        .relative()
        .flex_none()
        .w(width)
        .h_full()
        .flex()
        .items_center()
        .gap(unit(8.))
        .pl(unit(ASIDE_GUTTER))
        .pr(unit(8.))
        .overflow_hidden()
        .child(divider);
    header_contents(row, header, HeaderScale::ASIDE, toolbar_end, cx)
}

/// The sidebar beside the canvas: a resizable split normally, or a floating layer over the
/// canvas when the window is too narrow for both.
fn sidebar_and_canvas(sidebar: AnyElement, canvas: Div, window: &Window, cx: &App) -> AnyElement {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let compact = window.viewport_size().width < unit(crate::scale::COLUMN_READ);
    if compact {
        // At large zoom levels, the sidebar overlays content instead of squeezing the
        // page below its usable width. The toolbar toggle still opens and closes it.
        return div()
            .relative()
            .size_full()
            .pl(unit(4.))
            .child(canvas)
            .child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .bottom_0()
                    .w(unit(260.))
                    .rounded_r(unit(crate::scale::RADIUS_LG))
                    .overflow_hidden()
                    .border_1()
                    .border_color(colors.border)
                    .shadow(crate::float_shadow(cx))
                    .child(sidebar),
            )
            .into_any_element();
    }

    // Native split state is in pixels, so each display scale keeps its own (see `ids`).
    // The canvas is set apart by tone alone, so the divider draws nothing at rest and shows
    // the kit's grip only while the pointer is on it.
    let appearance = resize_handle_appearance();
    let handle = Rc::new(
        move |handle: &ResizeHandleContext, window: &mut Window, cx: &mut App| match handle.state()
        {
            ResizeHandleState::Idle => Some(div().flex_none().into_any_element()),
            _ => appearance(handle, window, cx),
        },
    );
    h_resizable(ids::shell_split(cx.theme().font_size))
        .with_handle_appearance(handle)
        .child(
            resizable_panel()
                .size(unit(260.))
                .size_range(unit(220.)..unit(360.))
                .flex_none()
                .child(sidebar),
        )
        .child(
            resizable_panel()
                .size_range(unit(320.)..unit(10000.))
                .child(canvas),
        )
        .into_any_element()
}
