//! Keys a page answers itself, apart from the app's shortcuts.

use gpui_kit::Modifiers;

/// Whether a key pressed with these modifiers belongs to a shortcut (Ctrl, Cmd or Alt held)
/// rather than to the page that has focus. Shift doesn't count: it only changes the
/// character typed.
pub fn is_shortcut(modifiers: Modifiers) -> bool {
    modifiers.control || modifiers.platform || modifiers.alt
}
