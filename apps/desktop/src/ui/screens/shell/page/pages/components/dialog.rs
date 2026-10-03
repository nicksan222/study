//! Opening a dialog drawn from the shell's state as a floating layer, and where a dialog
//! sits in the window.

use crate::ui::screens::shell::page::*;
use gpui_kit::component::{WindowExt as _, dialog::Dialog};
use gpui_kit::{App, Pixels, Window};
use study_ui::units;

/// Opens a dialog that `build` draws afresh each frame from the shell's state, so what
/// changes while it is open (an error, a save under way) shows in it. It floats as every
/// layer above the page does: the raised tone, a hairline edge, the large radius.
pub(in crate::ui::screens::shell::page) fn show_dialog(
    build: impl Fn(&AppShell, Dialog, &Window, &mut Context<AppShell>) -> Dialog + 'static,
    window: &mut Window,
    cx: &mut Context<AppShell>,
) {
    let view = cx.entity().downgrade();
    window.open_dialog(cx, move |dialog, window, cx| {
        let Some(view) = view.upgrade() else {
            return dialog;
        };
        let dialog = floating(dialog, cx);
        view.update(cx, |this, cx| build(this, dialog, window, cx))
    });
}

/// `dialog` drawn as a floating layer: the raised tone, a hairline edge and the large
/// radius. GPUI Kit gives it its own shadow as it opens.
fn floating(dialog: Dialog, cx: &App) -> Dialog {
    let palette = study_ui::palette(cx);
    dialog
        .bg(palette.raised)
        .border_color(palette.border)
        .rounded(units(cx)(study_ui::scale::RADIUS_LG))
}

/// The top margin that centers a dialog about `height` tall in the window, never closer to
/// the top than a small gap.
pub(in crate::ui::screens::shell::page) fn centered_top(
    window: &Window,
    height: f32,
    cx: &App,
) -> Pixels {
    let unit = units(cx);
    ((window.viewport_size().height - unit(height)) / 2.).max(unit(24.))
}
