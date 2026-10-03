//! A project tree for a sidebar: folders that fold open onto their sessions, like a code
//! editor's file list. A project's row is in medium weight with a disclosure chevron; its
//! sessions hang 16 in below it in regular weight, so the two never read as the same thing.
//! A project's tools show only while its row is hovered, focused or holds the open session,
//! so at rest names get the whole width. Motion is short and never moves neighbouring layout.

use gpui_kit::assets::IconName;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, Selectable as _, button::Button};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    Animation, AnimationExt as _, AnyElement, App, ClickEvent, ElementId, InteractiveElement as _,
    IntoElement, MouseButton, ParentElement as _, RenderOnce, SharedString, Styled as _, Window,
    div, ease_out_quint,
};

use crate::ids::{ProjectGroupPart, project_group_motion};
use crate::row::{ClickHandler, RowHeight, RowSurface};

/// A project: a folder row that folds its sessions open and closed. Its actions show only
/// while the row or one of them is hovered or focused, or the row holds the selection
/// (`DESIGN.md`, Navigation: row tools).
#[derive(IntoElement)]
pub struct ProjectGroup {
    id: usize,
    name: SharedString,
    count: usize,
    expanded: bool,
    active: bool,
    actions: Vec<Button>,
    on_toggle: Option<ClickHandler>,
    rows: Vec<AnyElement>,
}

impl ProjectGroup {
    /// `id` must be unique in the window; the motion of its parts uses ids derived from it.
    pub fn new(id: usize, name: impl Into<SharedString>) -> Self {
        Self {
            id,
            name: name.into(),
            count: 0,
            expanded: true,
            active: false,
            actions: Vec::new(),
            on_toggle: None,
            rows: Vec::new(),
        }
    }

    /// How many sessions the project has, shown while it is folded.
    pub fn count(mut self, count: usize) -> Self {
        self.count = count;
        self
    }

    /// Whether the sessions are shown; groups start expanded.
    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = expanded;
        self
    }

    /// Whether the open session belongs to this project.
    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    /// A control at the end of the folder row, such as "new session", usually an
    /// [`icon_button`](crate::icon_button).
    pub fn action(mut self, action: Button) -> Self {
        self.actions.push(action);
        self
    }

    /// Called when the folder row is clicked to fold or unfold.
    pub fn on_toggle(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_toggle = Some(Box::new(handler));
        self
    }

    /// Adds a session, usually a [`SessionRow`].
    pub fn row(mut self, row: impl IntoElement) -> Self {
        self.rows.push(row.into_any_element());
        self
    }
}

/// The group name of a project's row, which reveals its tools while the pointer is over it.
const ROW: &str = "project-row";

impl RenderOnce for ProjectGroup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let surface = RowSurface::new(&ElementId::from(self.id), false, false, window, cx);
        let focus = window.with_element_namespace(ElementId::from(self.id), |window| {
            window
                .use_keyed_state(crate::ids::PROJECT_TOOLS_FOCUS, cx, |_, cx| {
                    cx.focus_handle()
                })
                .read(cx)
                .clone()
        });
        // Hover reveals them by style alone (the `ROW` group); focus anywhere in the row and
        // holding the open session keep them shown.
        let shown = self.active || focus.contains_focused(window, cx);
        let height = RowHeight::of(window, cx);
        let count = (!self.expanded && self.count > 0).then_some(self.count);
        let meta = surface.meta(cx);
        let header = header_button(
            self.id,
            self.name,
            (self.expanded, self.active),
            count,
            meta,
            cx,
        )
        .min_h(height.min)
        .py(height.padding);
        // The row's tools lie over the end of the row instead of beside it, so at rest the
        // name has the whole width; the focus handle is tracked across both, so focus on
        // either counts.
        let head = div()
            .relative()
            .w_full()
            .flex()
            .items_center()
            .group(ROW)
            .track_focus(&focus)
            .child(surface.paint(header, self.on_toggle, cx))
            .when(!self.actions.is_empty(), |head| {
                head.child(tools(self.actions, shown, cx))
            });
        let rows = self.expanded.then(|| sessions(self.id, self.rows, cx));
        div().w_full().flex().flex_col().child(head).children(rows)
    }
}

/// A project's tools at the end of its row, on the row's tone so the name ends under them;
/// invisible but still in reach until revealed.
fn tools(actions: Vec<Button>, shown: bool, cx: &App) -> impl IntoElement {
    let unit = crate::theme::units(cx);
    let palette = crate::theme::palette(cx);
    div()
        .absolute()
        .top_0()
        .bottom_0()
        .right_0()
        .pl(unit(crate::scale::SPACE_XXS))
        .flex()
        .items_center()
        .rounded(unit(crate::scale::RADIUS_MD))
        .bg(palette.sidebar)
        .opacity(if shown { 1. } else { 0. })
        .group_hover(ROW, move |style| style.opacity(1.).bg(palette.hover))
        // A press here is the tool's, never the row's under it: the row would fold.
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .children(actions)
}

/// The chevron and folder, open or closed. They swap with a quick fade, so folding reads as
/// one gesture.
fn glyphs(id: usize, expanded: bool, active: bool, cx: &App) -> impl IntoElement {
    let unit = crate::theme::units(cx);
    let palette = crate::theme::palette(cx);
    let (chevron, folder) = if expanded {
        (IconName::ChevronDown, IconName::FolderOpen)
    } else {
        (IconName::ChevronRight, IconName::Folder)
    };
    div()
        .flex_none()
        .flex()
        .items_center()
        .gap(unit(crate::scale::SPACE_XXS))
        .text_color(if active {
            palette.foreground
        } else {
            palette.muted
        })
        .child(crate::icon::icon(chevron).size(unit(14.)))
        .child(crate::icon::icon(folder).size(unit(16.)))
        .with_animation(
            project_group_motion(id, ProjectGroupPart::Glyphs { expanded }),
            Animation::new(cx.theme().motion.duration_normal).with_easing(ease_out_quint()),
            |element, progress| element.opacity(0.45 + 0.55 * progress),
        )
}

/// The folder row's button: glyphs, the project's name and, while folded, its `count` in
/// the `meta` colour. It is `expanded` and holds the open session when `active`. The caller
/// sets its height.
fn header_button(
    id: usize,
    name: SharedString,
    (expanded, active): (bool, bool),
    count: Option<usize>,
    meta: gpui_kit::Hsla,
    cx: &App,
) -> Button {
    let unit = crate::theme::units(cx);
    let content = div()
        .w_full()
        .min_w_0()
        .flex()
        .items_center()
        .gap(unit(8.))
        .child(glyphs(id, expanded, active, cx))
        .child(
            div()
                .min_w_0()
                .flex_1()
                .whitespace_normal()
                .line_clamp(2)
                .text_left()
                .text_size(unit(crate::scale::TEXT_UI))
                .line_height(unit(20.))
                .font_weight(gpui_kit::FontWeight::MEDIUM)
                .child(name.clone()),
        )
        .children(count.map(|count| {
            div()
                .flex_none()
                .text_size(unit(crate::scale::TEXT_CAPTION))
                .text_color(meta)
                .child(count.to_string())
        }));
    Button::new(id)
        .accessibility_label(name)
        .rounded(unit(crate::scale::RADIUS_MD))
        .tab_stop(true)
        .flex_1()
        .min_w_0()
        .h_auto()
        .px(unit(crate::scale::SPACE_XS))
        .child(content)
}

/// The sessions, set 16 in from the folder so they read as its contents, and sliding in as
/// it opens.
fn sessions(id: usize, rows: Vec<AnyElement>, cx: &App) -> impl IntoElement {
    let unit = crate::theme::units(cx);
    div()
        .ml(unit(crate::scale::SPACE_MD))
        .mt(unit(1.))
        .mb(unit(crate::scale::SPACE_XXS))
        .flex()
        .flex_col()
        .gap(unit(1.))
        .children(rows)
        .with_animation(
            project_group_motion(id, ProjectGroupPart::Rows),
            Animation::new(cx.theme().motion.duration_normal).with_easing(ease_out_quint()),
            move |element, progress| {
                element
                    .relative()
                    .top(unit(-5. * (1. - progress)))
                    .opacity(progress)
            },
        )
}

/// One session under a project: a small title with how long ago it was active.
#[derive(IntoElement)]
pub struct SessionRow {
    id: ElementId,
    title: SharedString,
    age: Option<SharedString>,
    selected: bool,
    disabled: bool,
    on_click: Option<ClickHandler>,
}

impl SessionRow {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            age: None,
            selected: false,
            disabled: false,
            on_click: None,
        }
    }

    /// How long ago the session was active, already formatted.
    pub fn age(mut self, age: impl Into<SharedString>) -> Self {
        self.age = Some(age.into());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for SessionRow {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let duration = cx.theme().motion.duration_normal;
        let surface = RowSurface::new(&self.id, self.selected, self.disabled, window, cx);
        let height = RowHeight::of(window, cx);
        let meta = surface.meta(cx);
        let palette = crate::theme::palette(cx);
        let unit = crate::theme::units(cx);
        let tint = if self.selected {
            palette.foreground
        } else {
            palette.muted
        };
        // A long title wraps to a second line rather than lose its end; the glyph and the
        // age keep to its first line.
        let content = div()
            .w_full()
            .min_w_0()
            .flex()
            .items_start()
            .gap(unit(8.))
            .child(
                div()
                    .flex_none()
                    .h(unit(20.))
                    .flex()
                    .items_center()
                    .text_color(tint)
                    .child(crate::icon::icon(IconName::NotebookText).size(unit(16.))),
            )
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .whitespace_normal()
                    .line_clamp(2)
                    .text_left()
                    .text_size(unit(crate::scale::TEXT_UI))
                    .line_height(unit(20.))
                    .child(self.title.clone()),
            )
            .children(self.age.map(|age| {
                div()
                    .flex_none()
                    .h(unit(20.))
                    .flex()
                    .items_center()
                    .text_size(unit(crate::scale::TEXT_CAPTION))
                    .text_color(meta)
                    .child(age)
            }));

        let row = Button::new(self.id.clone())
            .accessibility_label(self.title)
            .selected(self.selected)
            .disabled(self.disabled)
            .rounded(unit(crate::scale::RADIUS_MD))
            .tab_stop(true)
            .w_full()
            .min_w_0()
            .h_auto()
            .min_h(height.min)
            .px(unit(crate::scale::SPACE_XS))
            .py(height.padding)
            .child(content);
        let row = surface.paint(row, self.on_click, cx);
        // A session appears with a soft fade the first time it is drawn.
        div().w_full().child(row).with_animation(
            self.id,
            Animation::new(duration).with_easing(ease_out_quint()),
            |element, progress| element.opacity(progress),
        )
    }
}
