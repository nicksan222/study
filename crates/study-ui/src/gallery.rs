//! Responsive columns measured from the actual content area, including sidebar resizing.

use gpui_kit::component::ElementExt as _;
use gpui_kit::{
    AnyElement, App, ElementId, IntoElement, ParentElement as _, RenderOnce, Styled as _, Window,
    div,
};

/// A grid of equal columns, as many as fit at a minimum width. It measures itself each frame,
/// so it settles one frame after its width changes.
#[derive(IntoElement)]
pub struct Gallery {
    id: ElementId,
    items: Vec<AnyElement>,
}

impl Gallery {
    /// `id` keys the remembered column count; keep it stable.
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            items: Vec::new(),
        }
    }

    pub fn item(mut self, item: impl IntoElement) -> Self {
        self.items.push(item.into_any_element());
        self
    }
}

impl RenderOnce for Gallery {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let columns = window.use_keyed_state(self.id, cx, |_, _| 1_u16);
        let count = *columns.read(cx);
        let gap = crate::theme::unit(cx, 16.);
        let minimum = crate::theme::unit(cx, 220.);
        div()
            .w_full()
            .grid()
            .grid_cols(count)
            .gap(gap)
            .children(self.items)
            .on_prepaint(move |bounds, window, cx| {
                let next = ((bounds.size.width + gap) / (minimum + gap))
                    .floor()
                    .max(1.) as u16;
                if *columns.read(cx) != next {
                    columns.update(cx, |columns, _| *columns = next);
                    window.refresh();
                }
            })
    }
}
