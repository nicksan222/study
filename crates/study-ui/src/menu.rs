//! Menu rows for navigation, and the labelled sections that group them. The shared row hover
//! surface is in `row.rs`; single choices are [`ChoiceCard`](crate::ChoiceCard)s.

use gpui_kit::assets::IconName;
use gpui_kit::component::{Disableable as _, Selectable as _, button::Button};
use gpui_kit::{
    AnyElement, App, ClickEvent, ElementId, IntoElement, ParentElement as _, RenderOnce,
    SharedString, Styled as _, Window, div, prelude::FluentBuilder as _,
};

use crate::row::{ClickHandler, RowHeight, RowSurface};

/// An accessible menu row backed by GPUI Kit's native [`Button`].
///
/// A trailing action is rendered beside the primary button so its click and
/// keyboard activation never bubble through the row's main action.
#[derive(IntoElement)]
pub struct MenuItem {
    id: ElementId,
    label: SharedString,
    icon: Option<IconName>,
    leading: Option<AnyElement>,
    description: Option<SharedString>,
    accessory: Option<AnyElement>,
    actions: Vec<Button>,
    selected: bool,
    disabled: bool,
    depth: usize,
    on_click: Option<ClickHandler>,
}

impl MenuItem {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon: None,
            leading: None,
            description: None,
            accessory: None,
            actions: Vec::new(),
            selected: false,
            disabled: false,
            depth: 0,
            on_click: None,
        }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// Replace the standard icon slot with arbitrary noninteractive content.
    pub fn leading(mut self, leading: impl IntoElement) -> Self {
        self.leading = Some(leading.into_any_element());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Add noninteractive trailing content to the primary button.
    pub fn accessory(mut self, accessory: impl IntoElement) -> Self {
        self.accessory = Some(accessory.into_any_element());
        self
    }

    /// Add a separately focusable trailing action beside the primary button.
    pub fn action(mut self, action: Button) -> Self {
        self.actions.push(action);
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

    /// Nesting level; each level indents the row 16 more.
    pub fn depth(mut self, depth: usize) -> Self {
        self.depth = depth;
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

impl RenderOnce for MenuItem {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let surface = RowSurface::new(&self.id, self.selected, self.disabled, window, cx);
        let height = RowHeight::of(window, cx);
        let meta = surface.meta(cx);
        let palette = crate::theme::palette(cx);
        let unit = crate::theme::units(cx);
        let left_padding =
            unit(crate::scale::SPACE_XS + self.depth as f32 * crate::scale::SPACE_MD);

        let leading = self.leading.or_else(|| {
            self.icon.map(|icon| {
                crate::icon::icon(icon)
                    .size(unit(16.))
                    .text_color(if self.selected {
                        palette.foreground
                    } else {
                        palette.muted
                    })
                    .into_any_element()
            })
        });
        // Metadata on the right, such as a count: caption size, faint until the row is
        // hovered or selected. It shares the label's line, so the description below keeps
        // the row's full width.
        let accessory = self.accessory.map(|accessory| {
            div()
                .flex_none()
                .h(unit(20.))
                .flex()
                .items_center()
                .text_size(unit(crate::scale::TEXT_CAPTION))
                .text_color(meta)
                .child(accessory)
        });
        let text = div()
            .min_w_0()
            .flex_1()
            .flex()
            .flex_col()
            .items_start()
            .gap(unit(2.))
            .child(
                div()
                    .w_full()
                    .min_w_0()
                    .flex()
                    .items_start()
                    .gap(unit(8.))
                    .child(
                        // Long names wrap to a second line rather than lose their end
                        // (`DESIGN.md`).
                        div()
                            .flex_1()
                            .min_w_0()
                            .whitespace_normal()
                            .line_clamp(2)
                            .text_left()
                            .text_size(unit(crate::scale::TEXT_UI))
                            .line_height(unit(20.))
                            .child(self.label.clone()),
                    )
                    .children(accessory),
            )
            .children(self.description.map(|description| {
                div()
                    .w_full()
                    .whitespace_normal()
                    .text_left()
                    .text_size(unit(crate::scale::TEXT_SMALL))
                    .line_height(unit(18.))
                    .text_color(meta)
                    .child(description)
            }));

        let content = div()
            .w_full()
            .min_w_0()
            .flex()
            .items_start()
            .gap(unit(8.))
            // The glyph keeps to the label's first line.
            .children(leading.map(|leading| {
                div()
                    .flex_none()
                    .h(unit(20.))
                    .flex()
                    .items_center()
                    .child(leading)
            }))
            .child(text);

        let primary = Button::new(self.id)
            .accessibility_label(self.label)
            .selected(self.selected)
            .disabled(self.disabled)
            .rounded(unit(crate::scale::RADIUS_MD))
            .tab_stop(true)
            .flex_1()
            .min_w_0()
            .h_auto()
            .min_h(height.min)
            .pl(left_padding)
            .pr(unit(crate::scale::SPACE_XS))
            .py(height.padding)
            .child(content);
        // Interaction animation belongs to the row, never to screen state.
        let primary = surface.paint(primary, self.on_click, cx);

        // A disabled row disables its actions too; an enabled one leaves each action's own
        // state.
        let actions = self
            .actions
            .into_iter()
            .map(|action| action.when(self.disabled, |action| action.disabled(true)));

        div()
            .w_full()
            .flex()
            .items_center()
            .gap(unit(4.))
            .child(primary)
            .children(actions.map(|action| div().flex_none().child(action)))
    }
}

/// A labelled group of related menu rows with an optional header action.
#[derive(IntoElement)]
pub struct MenuSection {
    label: SharedString,
    items: Vec<AnyElement>,
    actions: Vec<Button>,
}

impl MenuSection {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            items: Vec::new(),
            actions: Vec::new(),
        }
    }

    pub fn item(mut self, item: impl IntoElement) -> Self {
        self.items.push(item.into_any_element());
        self
    }

    /// A control at the trailing edge of the section's label.
    pub fn action(mut self, action: Button) -> Self {
        self.actions.push(action);
        self
    }
}

impl RenderOnce for MenuSection {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        div()
            .w_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .min_h(unit(28.))
                    .px(unit(crate::scale::SPACE_XS))
                    .flex()
                    .items_center()
                    .gap(unit(8.))
                    .text_size(unit(crate::scale::TEXT_CAPTION))
                    .font_weight(gpui_kit::FontWeight::MEDIUM)
                    .text_color(crate::theme::palette(cx).faint)
                    .child(div().min_w_0().flex_1().child(self.label))
                    .children(
                        self.actions
                            .into_iter()
                            .map(|action| div().flex_none().child(action)),
                    ),
            )
            .children(self.items)
    }
}
