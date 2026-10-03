//! A text box or picker under a name of the page's own: the controls GPUI Kit names for
//! themselves change name every run, so tests and agents find them by this one instead.

use gpui_kit::base::TestSupportExt as _;
use gpui_kit::{
    AnyElement, ElementId, InteractiveElement as _, IntoElement, ParentElement as _, SharedString,
    StatefulInteractiveElement as _, Styled as _, div,
};

/// `field`, wrapped full width in an element called `id` that says `label`. A click on it
/// lands on the field.
pub(in crate::ui::screens::shell::page) fn named_field(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    field: impl IntoElement,
) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .aria_label(label)
        .w_full()
        .child(field)
        .into_any_element()
}
