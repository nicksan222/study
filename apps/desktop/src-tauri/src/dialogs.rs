//! Native file pickers and external authorization links; domain changes remain RPC calls.
use crate::rpc::RpcError;
use tauri::Manager as _;
use tauri_plugin_dialog::DialogExt as _;

fn file_dialog(app: &tauri::AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    match app.get_webview_window("main") {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}

#[tauri::command]
pub async fn pick_files(app: tauri::AppHandle) -> Result<Vec<String>, RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        file_dialog(&app)
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|_| RpcError::invalid("a local file is required"))
            })
            .collect()
    })
    .await
    .map_err(|_| RpcError::internal("file picker failed"))?
}

#[tauri::command]
pub async fn pick_export(
    app: tauri::AppHandle,
    default_name: String,
) -> Result<Option<String>, RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        file_dialog(&app)
            .set_file_name(default_name)
            .blocking_save_file()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|_| RpcError::invalid("a local destination is required"))
            })
            .transpose()
    })
    .await
    .map_err(|_| RpcError::internal("file picker failed"))?
}

fn validate_external(url: &str) -> Result<(), RpcError> {
    // Only browser authorization/documentation URLs. In particular, never open file or
    // arbitrary desktop protocol handlers from a webview request.
    let parsed = url::Url::parse(url).map_err(|_| RpcError::invalid("invalid external URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(RpcError::invalid("external links require HTTP or HTTPS"));
    }
    Ok(())
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), RpcError> {
    validate_external(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        webbrowser::open(&url).map_err(|_| RpcError::internal("cannot open browser"))
    })
    .await
    .map_err(|_| RpcError::internal("cannot open browser"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_links_allow_browser_urls_only() {
        assert!(validate_external("https://auth.openai.com/authorize").is_ok());
        assert!(validate_external("http://localhost:1455/auth/callback").is_ok());
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:a@b.test",
            "not a URL",
        ] {
            assert!(validate_external(url).is_err(), "{url}");
        }
    }
}

#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    default_name: String,
    bytes: Vec<u8>,
) -> Result<bool, RpcError> {
    if bytes.len() as u64 > study_core::db::MAX_SOURCE_BYTES {
        return Err(RpcError::invalid("export exceeds transport limit"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = file_dialog(&app)
            .set_file_name(default_name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selected
            .into_path()
            .map_err(|_| RpcError::invalid("a local destination is required"))?;
        let parent = path
            .parent()
            .ok_or_else(|| RpcError::invalid("invalid destination"))?;
        let mut file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| RpcError::internal("cannot create export"))?;
        use std::io::Write as _;
        file.write_all(&bytes)
            .and_then(|()| file.as_file().sync_all())
            .map_err(|_| RpcError::internal("cannot write export"))?;
        file.persist(path)
            .map_err(|_| RpcError::internal("cannot save export"))?;
        Ok(true)
    })
    .await
    .map_err(|_| RpcError::internal("export failed"))?
}
