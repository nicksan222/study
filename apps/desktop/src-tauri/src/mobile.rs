//! Keeps the main webview and its paired-device connection available from the system tray.

use crate::transport::NativeError;
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

const TRAY_ID: &str = "study-mobile";
const OPEN: &str = "study-mobile-open";
const QUIT: &str = "study-mobile-quit";

#[tauri::command]
pub fn set_mobile_background(
    app: tauri::AppHandle,
    enabled: bool,
    open_label: String,
    quit_label: String,
) -> Result<(), NativeError> {
    if !enabled {
        app.remove_tray_by_id(TRAY_ID);
        return Ok(());
    }

    let configure = || -> tauri::Result<()> {
        let open = MenuItem::with_id(&app, OPEN, open_label, true, None::<&str>)?;
        let quit = MenuItem::with_id(&app, QUIT, quit_label, true, None::<&str>)?;
        let menu = Menu::with_items(&app, &[&open, &quit])?;
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray.set_menu(Some(menu))?;
            return Ok(());
        }

        let mut tray = TrayIconBuilder::with_id(TRAY_ID).menu(&menu);
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(&app)?;
        Ok(())
    };

    configure().map_err(|error| NativeError::internal(error.to_string()))
}

pub fn handle_close(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event
        && window.label() == "main"
        && window.app_handle().tray_by_id(TRAY_ID).is_some()
        && window.hide().is_ok()
    {
        api.prevent_close();
    }
}

pub fn handle_menu(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        OPEN => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        QUIT => app.exit(0),
        _ => {}
    }
}
