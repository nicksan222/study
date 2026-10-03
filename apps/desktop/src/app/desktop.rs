//! Native application actions and menus. GPUI Kit owns their platform behavior.

use gpui_kit::{App, KeyBinding, Menu, MenuItem, actions};
use study_localization::{Locale, Message, text};

/// The id the system knows the app and its windows by.
pub(crate) const APP_ID: &str = "io.github.nicksan222.Study";

actions!(
    study,
    [
        ZoomIn,
        ZoomOut,
        ResetZoom,
        ToggleSidebar,
        ToggleFullscreen,
        OpenSettings,
        OpenSearch,
        CloseWindow,
        Quit
    ]
);

/// Binds the app-wide shortcuts. Zoom has none here: the shell reads its keys before any
/// text field can take them.
pub(crate) fn bind_shortcuts(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("f11", ToggleFullscreen, None),
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-,", OpenSettings, None),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-,", OpenSettings, None),
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-k", OpenSearch, None),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-k", OpenSearch, None),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-cmd-f", ToggleFullscreen, None),
    ]);
}

/// Names the app and installs its menus, native and in the window, in `locale`.
pub(crate) fn install(locale: Locale, cx: &mut App) {
    cx.set_app_identity(APP_ID, text(locale, Message::AppName));
    let menus = || {
        vec![
            Menu::new(text(locale, Message::AppName)).items([
                MenuItem::action(text(locale, Message::Settings), OpenSettings),
                MenuItem::separator(),
                MenuItem::action(text(locale, Message::CloseWindow), CloseWindow),
                MenuItem::action(text(locale, Message::Quit), Quit),
            ]),
            Menu::new(text(locale, Message::ViewMenu)).items([
                MenuItem::action(text(locale, Message::Search), OpenSearch),
                MenuItem::separator(),
                MenuItem::action(text(locale, Message::ZoomIn), ZoomIn),
                MenuItem::action(text(locale, Message::ZoomOut), ZoomOut),
                MenuItem::action(text(locale, Message::ResetZoom), ResetZoom),
                MenuItem::separator(),
                MenuItem::action(text(locale, Message::ToggleSidebar), ToggleSidebar),
                MenuItem::action(text(locale, Message::ToggleFullscreen), ToggleFullscreen),
            ]),
        ]
    };
    cx.set_menus(menus());
    gpui_kit::base::GlobalState::global_mut(cx)
        .set_app_menus(menus().into_iter().map(Menu::owned).collect());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::testing::{TempApp, open_shell};
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AppContext as _, TestAppContext};

    #[gpui_kit::test]
    fn fullscreen_shortcut_toggles_native_window(cx: &mut TestAppContext) {
        let temp = TempApp::new();
        let (window, _shell) = open_shell(cx, temp.app(), Preferences::default());
        cx.update(|cx| {
            bind_shortcuts(cx);
            install(Locale::English, cx);
        });
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            assert!(!window.is_fullscreen());
            window.press("f11", cx);
            assert!(window.is_fullscreen());
            window.press("f11", cx);
            assert!(!window.is_fullscreen());
        })
        .unwrap();
    }
}
