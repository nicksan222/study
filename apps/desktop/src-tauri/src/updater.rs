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

#[derive(serde::Serialize)]
pub struct UpdateStatus {
    version: String,
    supported: bool,
}

#[tauri::command]
pub fn desktop_update_status(app: tauri::AppHandle) -> UpdateStatus {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(serde_json::Value::as_str);
    let supported = updater_supported(cfg!(debug_assertions), key);
    UpdateStatus {
        version: app.package_info().version.to_string(),
        supported,
    }
}

fn updater_supported(debug: bool, key: Option<&str>) -> bool {
    !debug && key.is_some_and(|key| !key.is_empty())
}

#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<String>, NativeError> {
    let mut update = pending.update.lock().await;
    replace_checked(
        &mut update,
        desktop_update_status(app.clone()).supported,
        || async {
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
            tokio::time::timeout(std::time::Duration::from_secs(30), updater.check())
                .await
                .map_err(|error| NativeError::internal(error.to_string()))?
                .map_err(update_error)
        },
    )
    .await?;
    Ok(update.as_ref().map(|update| update.version.clone()))
}

// A failed check retains the previous checked update; unsupported builds clear it.
async fn replace_checked<T, F, Fut>(
    pending: &mut Option<T>,
    supported: bool,
    check: F,
) -> Result<(), NativeError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Option<T>, NativeError>>,
{
    if supported {
        *pending = check().await?;
    } else {
        *pending = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    expected_version: String,
) -> Result<(), NativeError> {
    install_checked(
        &pending.update,
        &expected_version,
        &DesktopInstall {
            app,
            pending: &pending,
        },
    )
    .await
}

trait InstallOperations {
    type Update: Clone;
    fn version(update: &Self::Update) -> &str;
    async fn download(&self, update: &Self::Update) -> Result<Vec<u8>, NativeError>;
    async fn install(&self, update: Self::Update, bytes: Vec<u8>) -> Result<(), NativeError>;
    async fn shutdown(&self);
    fn restart(&self);
    fn restart_after_failure(&self) -> bool;
}

struct DesktopInstall<'a> {
    app: tauri::AppHandle,
    pending: &'a PendingUpdate,
}

impl InstallOperations for DesktopInstall<'_> {
    type Update = tauri_plugin_updater::Update;
    fn version(update: &Self::Update) -> &str {
        &update.version
    }
    async fn download(&self, update: &Self::Update) -> Result<Vec<u8>, NativeError> {
        update
            .download(|_, _| {}, || {})
            .await
            .map_err(update_error)
    }
    async fn install(&self, update: Self::Update, bytes: Vec<u8>) -> Result<(), NativeError> {
        // Windows invokes its synchronous pre-exit callback during installation.
        // Keep the async runtime available while that callback waits for server shutdown.
        tauri::async_runtime::spawn_blocking(move || update.install(bytes))
            .await
            .map_err(|error| NativeError::internal(error.to_string()))?
            .map_err(update_error)
    }
    async fn shutdown(&self) {
        crate::shutdown_server(&self.app).await;
    }
    fn restart(&self) {
        self.app.restart();
    }
    fn restart_after_failure(&self) -> bool {
        cfg!(windows) && self.pending.shutdown_started.load(Ordering::Acquire)
    }
}

// Keep the checked update locked until installation finishes, including on failure.
async fn install_checked<O: InstallOperations>(
    pending: &tokio::sync::Mutex<Option<O::Update>>,
    expected: &str,
    operations: &O,
) -> Result<(), NativeError> {
    let checked = pending
        .try_lock()
        .map_err(|_| NativeError::internal("update operation already in progress"))?;
    let update = checked
        .as_ref()
        .ok_or_else(|| NativeError::internal("no checked update"))?;
    verify_announced_version(O::version(update), expected)?;
    let bytes = operations.download(update).await?;
    if let Err(error) = operations.install(update.clone(), bytes).await {
        if operations.restart_after_failure() {
            operations.restart();
        }
        return Err(error);
    }
    operations.shutdown().await;
    operations.restart();
    Ok(())
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
    fn support_requires_a_release_build_and_public_key() {
        assert!(!updater_supported(true, Some("key")));
        assert!(!updater_supported(false, None));
        assert!(!updater_supported(false, Some("")));
        assert!(updater_supported(false, Some("key")));
    }

    #[tokio::test]
    async fn checking_clears_unsupported_and_replaces_successful_results() {
        let mut pending = Some("old");
        replace_checked(&mut pending, false, || async {
            panic!("unsupported must not check")
        })
        .await
        .unwrap();
        assert_eq!(pending, None);
        replace_checked(&mut pending, true, || async { Ok(Some("new")) })
            .await
            .unwrap();
        assert_eq!(pending, Some("new"));
        assert!(
            replace_checked(&mut pending, true, || async {
                Err(NativeError::internal("network"))
            })
            .await
            .is_err()
        );
        assert_eq!(pending, Some("new"));
        replace_checked(&mut pending, true, || async { Ok(None) })
            .await
            .unwrap();
        assert_eq!(pending, None);
    }

    #[tokio::test]
    async fn installation_rejects_missing_stale_and_concurrent_requests() {
        let pending = tokio::sync::Mutex::new(None::<String>);
        let calls = std::sync::Mutex::new(Vec::new());
        assert!(exercise(&pending, "1", &calls, false).await.is_err());
        *pending.lock().await = Some("2".into());
        assert!(exercise(&pending, "1", &calls, false).await.is_err());
        let held = pending.lock().await;
        assert!(exercise(&pending, "2", &calls, false).await.is_err());
        drop(held);
        assert!(calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn failed_install_remains_retryable_and_success_shuts_down_before_restart() {
        let pending = tokio::sync::Mutex::new(Some("1".to_string()));
        let calls = std::sync::Mutex::new(Vec::new());
        assert!(exercise(&pending, "1", &calls, true).await.is_err());
        exercise(&pending, "1", &calls, false).await.unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            [
                "download", "install", "download", "install", "shutdown", "restart"
            ]
        );
    }

    struct TestInstall<'a> {
        calls: &'a std::sync::Mutex<Vec<&'static str>>,
        fail: bool,
        fail_download: bool,
        restart_failure: bool,
    }
    impl InstallOperations for TestInstall<'_> {
        type Update = String;
        fn version(update: &String) -> &str {
            update
        }
        async fn download(&self, _: &String) -> Result<Vec<u8>, NativeError> {
            self.calls.lock().unwrap().push("download");
            if self.fail_download {
                Err(NativeError::internal("download failed"))
            } else {
                Ok(vec![])
            }
        }
        async fn install(&self, _: String, _: Vec<u8>) -> Result<(), NativeError> {
            self.calls.lock().unwrap().push("install");
            if self.fail {
                Err(NativeError::internal("failed"))
            } else {
                Ok(())
            }
        }
        async fn shutdown(&self) {
            self.calls.lock().unwrap().push("shutdown");
        }
        fn restart(&self) {
            self.calls.lock().unwrap().push("restart");
        }
        fn restart_after_failure(&self) -> bool {
            self.restart_failure
        }
    }
    async fn exercise(
        pending: &tokio::sync::Mutex<Option<String>>,
        expected: &str,
        calls: &std::sync::Mutex<Vec<&'static str>>,
        fail: bool,
    ) -> Result<(), NativeError> {
        install_checked(
            pending,
            expected,
            &TestInstall {
                calls,
                fail,
                fail_download: false,
                restart_failure: false,
            },
        )
        .await
    }

    #[tokio::test]
    async fn download_failure_can_retry_without_shutdown() {
        let pending = tokio::sync::Mutex::new(Some("1".to_string()));
        let calls = std::sync::Mutex::new(Vec::new());
        let operations = TestInstall {
            calls: &calls,
            fail: false,
            fail_download: true,
            restart_failure: false,
        };
        assert!(install_checked(&pending, "1", &operations).await.is_err());
        exercise(&pending, "1", &calls, false).await.unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            ["download", "download", "install", "shutdown", "restart"]
        );
    }

    #[tokio::test]
    async fn failed_windows_install_restarts_if_callback_already_shut_down() {
        let pending = tokio::sync::Mutex::new(Some("1".to_string()));
        let calls = std::sync::Mutex::new(Vec::new());
        let operations = TestInstall {
            calls: &calls,
            fail: true,
            fail_download: false,
            restart_failure: true,
        };
        assert!(install_checked(&pending, "1", &operations).await.is_err());
        assert_eq!(*calls.lock().unwrap(), ["download", "install", "restart"]);
    }

    #[test]
    fn installation_requires_the_announced_version() {
        assert!(verify_announced_version("0.1.42", "0.1.42").is_ok());
        assert!(verify_announced_version("0.1.43", "0.1.42").is_err());
        assert!(verify_announced_version("0.1.42", "").is_err());
    }
}

#[cfg(test)]
#[path = "updater_tests.rs"]
mod integration_tests;
