//! Single-choice pickers as cards laid out in a responsive grid: each option shows a visual,
//! a name, and a line about it, on the quiet fill; the chosen one takes the selected tone and
//! a tick, never an outline.

use gpui_kit::assets::IconName;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, Selectable as _, button::Button};
use gpui_kit::{
    AnyElement, App, ClickEvent, ElementId, IntoElement, ParentElement as _, RenderOnce,
    SharedString, Styled as _, Window, div, prelude::FluentBuilder as _,
};

use crate::row::{ClickHandler, RowSurface};

/// One option of a single-choice picker.
#[derive(IntoElement)]
pub struct ChoiceCard {
    id: ElementId,
    title: SharedString,
    description: Option<SharedString>,
    icon: Option<IconName>,
    visual: Option<AnyElement>,
    selected: bool,
    disabled: bool,
    tick: bool,
    on_click: Option<ClickHandler>,
}

impl ChoiceCard {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            description: None,
            icon: None,
            visual: None,
            selected: false,
            disabled: false,
            tick: true,
            on_click: None,
        }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// A picture of the option in place of the icon, such as a theme preview.
    pub fn visual(mut self, visual: impl IntoElement) -> Self {
        self.visual = Some(visual.into_any_element());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// A card that does something rather than picks an option, with no tick to choose it.
    pub fn action(mut self) -> Self {
        self.tick = false;
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

impl RenderOnce for ChoiceCard {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let fill = crate::theme::palette(cx).fill;
        let surface =
            RowSurface::resting_on(fill, &self.id, self.selected, self.disabled, window, cx);
        let colors = cx.theme().colors;
        let unit = crate::theme::units(cx);
        let visual = self.visual.or_else(|| {
            self.icon.map(|icon| {
                div()
                    .size(unit(32.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(unit(crate::scale::RADIUS_LG))
                    .bg(if self.selected {
                        colors.secondary_active
                    } else {
                        colors.secondary
                    })
                    .text_color(if self.selected {
                        colors.foreground
                    } else {
                        colors.muted_foreground
                    })
                    .child(crate::icon::icon(icon).size(unit(16.)))
                    .into_any_element()
            })
        });
        let tick = div()
            .flex_none()
            .size(unit(20.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(unit(crate::scale::RADIUS_MD))
            .border_1()
            .border_color(if self.selected {
                colors.primary
            } else {
                colors.border
            })
            .when(self.selected, |tick| {
                tick.bg(colors.primary)
                    .text_color(colors.primary_foreground)
                    .child(crate::icon::icon(IconName::Check).size(unit(13.)))
            });
        let content = div()
            .w_full()
            .p(unit(16.))
            .flex()
            .flex_col()
            .items_start()
            .gap(unit(12.))
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_start()
                    .justify_between()
                    .children(visual)
                    .when(self.tick, |row| row.child(tick)),
            )
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(unit(4.))
                    .child(
                        div()
                            .text_left()
                            .text_size(unit(crate::scale::TEXT_UI))
                            .font_weight(gpui_kit::FontWeight::MEDIUM)
                            .child(self.title.clone()),
                    )
                    .children(self.description.map(|description| {
                        div()
                            .w_full()
                            .text_left()
                            .whitespace_normal()
                            .text_size(unit(crate::scale::TEXT_SMALL))
                            .line_height(unit(18.))
                            .text_color(colors.muted_foreground)
                            .child(description)
                    })),
            );
        let card = Button::new(self.id)
            .accessibility_label(self.title)
            .toggled(self.selected)
            .selected(self.selected)
            .disabled(self.disabled)
            .tab_stop(true)
            .flex_1()
            // Three side by side in a reading column, wrapping only when narrower.
            .min_w(unit(200.))
            .h_auto()
            .p(unit(0.))
            .rounded(unit(crate::scale::RADIUS_LG))
            .child(content);
        surface.paint(card, self.on_click, cx)
    }
}

/// Cards side by side, wrapping onto new rows as the window narrows.
#[derive(IntoElement, Default)]
pub struct ChoiceGrid {
    cards: Vec<AnyElement>,
}

impl ChoiceGrid {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a card, usually a [`ChoiceCard`].
    pub fn card(mut self, card: impl IntoElement) -> Self {
        self.cards.push(card.into_any_element());
        self
    }
}

impl RenderOnce for ChoiceGrid {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        div()
            .w_full()
            .flex()
            .flex_wrap()
            .gap(unit(12.))
            .children(self.cards)
    }
}
