//! Native window hosting the shared web app and its private TypeScript server.
mod diagnostics;
mod logging;
mod server;
mod transport;
mod updater;
use tauri::Manager as _;
use transport::NativeError;

pub struct Shell {
    server: tokio::sync::Mutex<server::Server>,
}
#[tauri::command]
async fn server_connection(
    shell: tauri::State<'_, std::sync::Arc<Shell>>,
) -> Result<transport::Connection, NativeError> {
    Ok(shell.server.lock().await.client.connection())
}
#[tauri::command]
async fn diagnostic_log(app: tauri::AppHandle) -> Result<String, NativeError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| NativeError::internal(e.to_string()))?;
    diagnostics::recent(&data.join("diagnostics.log"))
        .map_err(|e| NativeError::internal(e.to_string()))
}
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            logging::install(&data);
            let resources = app.path().resource_dir()?;
            let bun = std::env::var_os("STUDY_BUN_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    if cfg!(debug_assertions) {
                        "bun".into()
                    } else {
                        resources.join(if cfg!(windows) { "bun.exe" } else { "bun" })
                    }
                });
            let entry = std::env::var_os("STUDY_SERVER_ENTRY")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    if cfg!(debug_assertions) {
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("../../../apps/server/src/runtime/main.ts")
                    } else {
                        resources.join("server/main.js")
                    }
                });
            let database = std::env::var_os("STUDY_DATABASE")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| data.join("study.sqlite"));
            let server =
                tauri::async_runtime::block_on(server::Server::start(bun, entry, database))
                    .map_err(|e| std::io::Error::other(e.message))?;
            app.manage(std::sync::Arc::new(Shell {
                server: tokio::sync::Mutex::new(server),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            server_connection,
            diagnostic_log,
            updater::check_for_update,
            updater::install_update
        ])
        .build(tauri::generate_context!());
    match result {
        Ok(application) => application.run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                tauri::async_runtime::block_on(shutdown_server(app));
            }
        }),
        Err(error) => {
            tracing::error!(%error, "desktop failed");
            std::process::exit(1);
        }
    }
}

async fn shutdown_server(app: &tauri::AppHandle) {
    if let Err(error) = app
        .state::<std::sync::Arc<Shell>>()
        .server
        .lock()
        .await
        .shutdown()
        .await
    {
        tracing::error!(message=%error.message, "server shutdown failed");
    }
}
