//! The interactive row surface shared by [`MenuItem`](crate::MenuItem),
//! [`ChoiceCard`](crate::ChoiceCard), [`ProjectGroup`](crate::ProjectGroup) and
//! [`SessionRow`](crate::SessionRow): a native button whose background eases between idle
//! (clear, or a tile's own fill), hovered (the hover tone) and selected (a full-width pill in
//! the selected tone). Change row hover feel here, not in each component.
//!
//! A new clickable row takes three steps in its `render`:
//!
//! ```text
//! let surface = RowSurface::new(&self.id, self.selected, self.disabled, window, cx);
//! let button = Button::new(self.id).selected(self.selected).disabled(self.disabled) /* layout */;
//! surface.paint(button, self.on_click, cx)
//! ```

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::button::{Button, ButtonCustomVariant, ButtonVariants as _};
use gpui_kit::{App, ClickEvent, ElementId, Entity, Hsla, Pixels, Styled as _, Window};

/// A click callback stored by a builder until render. Builders take it through an
/// `on_click(impl Fn(&ClickEvent, &mut Window, &mut App) + 'static)` method.
pub(crate) type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// The height of a one-line row and the padding above and below its 20-high line: 32, or
/// 28 in a window under 720 high, where the sidebar goes dense (`DESIGN.md`, Layout).
pub(crate) struct RowHeight {
    pub(crate) min: Pixels,
    pub(crate) padding: Pixels,
}

impl RowHeight {
    /// The window height, in design pixels, below which rows go dense.
    const DENSE_BELOW: f32 = 720.;

    pub(crate) fn of(window: &Window, cx: &App) -> Self {
        let unit = crate::theme::units(cx);
        if window.viewport_size().height < unit(Self::DENSE_BELOW) {
            Self {
                min: unit(28.),
                padding: unit(crate::scale::SPACE_XXS),
            }
        } else {
            Self {
                min: unit(32.),
                padding: unit(6.),
            }
        }
    }
}

/// A row's hover state and animated background for this frame: the selected tone when
/// `selected`, else the hover tone while hovered, never hovered while `disabled`.
pub(crate) struct RowSurface {
    hover: Entity<bool>,
    background: Hsla,
    /// Paints `background` at full strength at rest: a tile on its own fill, which the
    /// native button would show at a fifth.
    solid: bool,
    selected: bool,
    disabled: bool,
}

impl RowSurface {
    /// Reads the row's hover state, kept under `id`, and eases its background toward the
    /// color for the current state.
    pub(crate) fn new(
        id: &ElementId,
        selected: bool,
        disabled: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let clear = cx.theme().colors.secondary_hover.opacity(0.);
        Self {
            solid: false,
            ..Self::resting_on(clear, id, selected, disabled, window, cx)
        }
    }

    /// As [`RowSurface::new`], for a tile that rests on its own `fill` instead of on what is
    /// behind it.
    pub(crate) fn resting_on(
        fill: Hsla,
        id: &ElementId,
        selected: bool,
        disabled: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let colors = cx.theme().colors;
        window.with_element_namespace(id.clone(), |window| {
            let hover = window.use_keyed_state(0, cx, |_, _| false);
            let target = if selected {
                colors.secondary_active
            } else if !disabled && *hover.read(cx) {
                colors.secondary_hover
            } else {
                fill
            };
            let policy = gpui_kit::base::Transition::new(cx.theme().motion.duration_fast)
                .easing(cx.theme().motion.easing_move.clone());
            let background = gpui_kit::base::transition(1, target, policy, window, cx);
            Self {
                hover,
                background,
                solid: true,
                selected,
                disabled,
            }
        })
    }

    /// Whether the pointer is over the row, for parts that brighten with it.
    pub(crate) fn hovered(&self, cx: &App) -> bool {
        *self.hover.read(cx)
    }

    /// The colour of the row's metadata (an age, a count, a second line): the faint ink at
    /// rest, stepping up to the secondary ink on the hover or selected tone, where the faint
    /// one would read too weakly (`DESIGN.md`, the Contrast Floor).
    pub(crate) fn meta(&self, cx: &App) -> Hsla {
        if self.selected || self.hovered(cx) {
            crate::theme::palette(cx).muted
        } else {
            crate::theme::palette(cx).faint
        }
    }

    /// Paints `button` with the animated background, keeps the hover state in step with the
    /// pointer, and attaches `on_click`. The native button still owns focus, keyboard
    /// activation and disabled behavior.
    pub(crate) fn paint(self, button: Button, on_click: Option<ClickHandler>, cx: &App) -> Button {
        let Self {
            hover,
            background,
            solid,
            disabled,
            ..
        } = self;
        let button = button
            .custom(
                ButtonCustomVariant::new(cx)
                    .color(background)
                    .hover(background)
                    .active(cx.theme().colors.secondary_active),
            )
            .on_hover(move |value, _, cx| {
                hover.update(cx, |hovered, cx| {
                    *hovered = *value && !disabled;
                    cx.notify();
                });
            });
        let button = if solid { button.bg(background) } else { button };
        match on_click {
            Some(on_click) => button.on_click(on_click),
            None => button,
        }
    }
}
