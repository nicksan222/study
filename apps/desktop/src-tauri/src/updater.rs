//! Signed desktop updates; only an update checked by the native shell can be installed.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri_plugin_updater::UpdaterExt as _;

use crate::transport::NativeError;

#[derive(Default)]
pub struct PendingUpdate {
    update: tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    shutdown_started: Arc<AtomicBool>,
}

#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<String>, NativeError> {
    let mut update = pending.update.lock().await;
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
    let shutdown_started = pending.shutdown_started.clone();
    shutdown_started.store(false, Ordering::Release);
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(30 * 60))
        .on_before_exit(move || {
            shutdown_started.store(true, Ordering::Release);
            tauri::async_runtime::block_on(crate::shutdown_server(&handle));
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(update_error)?;
    *update = tokio::time::timeout(std::time::Duration::from_secs(30), updater.check())
        .await
        .map_err(|error| NativeError::internal(error.to_string()))?
        .map_err(update_error)?;
    Ok(update.as_ref().map(|update| update.version.clone()))
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    expected_version: String,
) -> Result<(), NativeError> {
    // Keep the lock through installation so concurrent commands cannot install twice.
    let checked = pending.update.lock().await;
    let update = checked
        .as_ref()
        .ok_or_else(|| NativeError::internal("no checked update"))?;
    verify_announced_version(&update.version, &expected_version)?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(update_error)?;
    let update = update.clone();
    // Windows runs the synchronous shutdown callback before launching its installer.
    // Installing on a blocking thread allows that callback to wait for the server.
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| NativeError::internal(error.to_string()))
        .and_then(|result| result.map_err(update_error));
    if let Err(error) = installed {
        if cfg!(windows) && pending.shutdown_started.load(Ordering::Acquire) {
            app.restart();
        }
        return Err(error);
    }
    crate::shutdown_server(&app).await;
    app.restart();
}

/// Reject stale notice actions before downloading or stopping the private server.
fn verify_announced_version(actual: &str, expected: &str) -> Result<(), NativeError> {
    if actual != expected {
        return Err(NativeError::internal(
            "announced update is no longer pending",
        ));
    }
    Ok(())
}

fn update_error(error: tauri_plugin_updater::Error) -> NativeError {
    tracing::warn!(%error, "desktop update failed");
    NativeError::internal(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_requires_the_announced_version() {
        assert!(verify_announced_version("0.1.42", "0.1.42").is_ok());
        assert!(verify_announced_version("0.1.43", "0.1.42").is_err());
        assert!(verify_announced_version("0.1.42", "").is_err());
    }
}
