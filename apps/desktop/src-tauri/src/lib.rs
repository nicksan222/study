//! Native window hosting the shared web app and its private TypeScript server.
mod diagnostics;
mod logging;
mod microphone;
mod mobile;
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
/// Returns a bounded snapshot of the canonical desktop diagnostic log.
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
    let builder = tauri::Builder::default();
    #[cfg(feature = "desktop-e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let result = builder
        .on_permission_request(microphone::permission)
        .on_window_event(mobile::handle_close)
        .on_menu_event(mobile::handle_menu)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            mobile::show_main(app);
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
            mobile::set_mobile_background,
            updater::desktop_update_status,
            updater::check_for_update,
            updater::install_update
        ])
        .build(tauri::generate_context!());
    match result {
        Ok(application) => application.run(|app, event| match event {
            tauri::RunEvent::Exit => tauri::async_runtime::block_on(shutdown_server(app)),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => mobile::show_main(app),
            _ => {}
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
