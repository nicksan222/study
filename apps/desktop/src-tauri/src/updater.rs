//! Signed desktop updates; only an update checked by the native shell can be installed.
use tauri_plugin_updater::UpdaterExt as _;

use crate::transport::NativeError;

#[derive(Default)]
pub struct PendingUpdate(tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<String>, NativeError> {
    let mut pending = pending.0.lock().await;
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c.get("pubkey"));
    if cfg!(debug_assertions)
        || key
            .and_then(serde_json::Value::as_str)
            .is_none_or(str::is_empty)
    {
        return Ok(None);
    }
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(30 * 60))
        .on_before_exit(move || {
            tauri::async_runtime::block_on(crate::shutdown_server(&handle));
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(update_error)?;
    *pending = tokio::time::timeout(std::time::Duration::from_secs(30), updater.check())
        .await
        .map_err(|error| NativeError::internal(error.to_string()))?
        .map_err(update_error)?;
    Ok(pending.as_ref().map(|update| update.version.clone()))
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<(), NativeError> {
    // Keep the lock through installation so concurrent commands cannot install twice.
    let pending = pending.0.lock().await;
    let update = pending
        .as_ref()
        .ok_or_else(|| NativeError::internal("no checked update"))?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(update_error)?;
    let update = update.clone();
    // Windows runs the synchronous shutdown callback before launching its installer.
    // Installing on a blocking thread allows that callback to wait for the server.
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| NativeError::internal(error.to_string()))?;
    if let Err(error) = installed {
        #[cfg(windows)]
        {
            update_error(error);
            app.restart();
        }
        #[cfg(not(windows))]
        return Err(update_error(error));
    }
    crate::shutdown_server(&app).await;
    app.restart();
}

fn update_error(error: tauri_plugin_updater::Error) -> NativeError {
    tracing::warn!(%error, "desktop update failed");
    NativeError::internal(error.to_string())
}
