//! Native entry point for the WebView's update confirmation flow.

use tauri::{
    Emitter as _,
    menu::{Menu, MenuEvent, MenuItem, Submenu},
};

use crate::transport::NativeError;

const MENU_ID: &str = "study-updates";
const CHECK_ID: &str = "study-check-for-updates";

#[tauri::command]
pub fn set_desktop_update_menu(
    app: tauri::AppHandle,
    menu_label: String,
    item_label: String,
) -> Result<(), NativeError> {
    if !crate::updater::desktop_update_status(app.clone()).supported {
        return Ok(());
    }

    let existing = app.menu();
    let menu = match &existing {
        Some(menu) => menu.clone(),
        None => Menu::new(&app).map_err(menu_error)?,
    };
    let submenu = if cfg!(target_os = "macos") {
        menu.items()
            .map_err(menu_error)?
            .first()
            .and_then(|item| item.as_submenu())
            .cloned()
            .ok_or_else(|| NativeError::internal("application menu unavailable"))?
    } else if let Some(submenu) = menu
        .get(MENU_ID)
        .and_then(|item| item.as_submenu().cloned())
    {
        submenu.set_text(&menu_label).map_err(menu_error)?;
        submenu
    } else {
        let submenu = Submenu::with_id(&app, MENU_ID, &menu_label, true).map_err(menu_error)?;
        menu.append(&submenu).map_err(menu_error)?;
        submenu
    };

    if let Some(item) = submenu
        .get(CHECK_ID)
        .and_then(|item| item.as_menuitem().cloned())
    {
        item.set_text(item_label).map_err(menu_error)?;
    } else {
        let item = MenuItem::with_id(&app, CHECK_ID, item_label, true, None::<&str>)
            .map_err(menu_error)?;
        submenu.append(&item).map_err(menu_error)?;
    }

    if existing.is_none() {
        app.set_menu(menu).map_err(menu_error)?;
    }

    Ok(())
}

pub fn on_menu_event(app: &tauri::AppHandle, event: MenuEvent) {
    if event.id() == CHECK_ID
        && let Err(error) = app.emit_to("main", "desktop-update-check", ())
    {
        tracing::warn!(%error, "could not request a desktop update check");
    }
}

fn menu_error(error: tauri::Error) -> NativeError {
    NativeError::internal(error.to_string())
}
