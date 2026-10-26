//! Tauri owns windows and native devices. All domain operations, including microphone
//! writes, consume the standalone protobuf contract over a private local gRPC channel.
mod audio;
mod diagnostics;
mod dialogs;
mod downsample;
mod logging;
mod recorder;
mod rpc;
mod server;
mod staging;
mod updates;

use rpc::{RpcClient, RpcError};
use tauri::{Emitter as _, Manager as _};

pub struct Shell {
    client: RpcClient,
    _server: server::NativeServer,
}

#[tauri::command]
async fn rpc(
    shell: tauri::State<'_, Shell>,
    microphone: tauri::State<'_, audio::Microphone>,
    method: String,
    payload: Vec<u8>,
) -> Result<Vec<u8>, RpcError> {
    microphone.rpc(&shell.client, &method, &payload).await
}

// Explicit handlers keep lifecycle actions available on Linux, where Tauri's
// predefined CloseWindow and Quit menu items are unsupported.
#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), RpcError> {
    window
        .close()
        .map_err(|error| RpcError::internal(error.to_string()))
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Run the native app with the real service and persistent user database.
pub fn run() {
    logging::install();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::PendingUpdate::default())
        .manage(audio::Microphone::default())
        .setup(|app| {
            app.manage(std::sync::Arc::new(staging::Staging::new()?));
            let (server, client) = tauri::async_runtime::block_on(async {
                let domain = tokio::task::spawn_blocking(|| {
                    let app = match std::env::var_os("STUDY_DATABASE") {
                        Some(path) => study_app::App::open(std::path::PathBuf::from(path)),
                        None => study_app::App::open_default(),
                    }?;
                    if std::env::var("STUDY_DISABLE_WORKERS").as_deref() != Ok("1")
                        && let Err(error) = app.start_workers() {
                            tracing::error!(error = format!("{error:#}"), "background work unavailable");
                    }
                    Ok::<_, study_core::Error>(app)
                })
                .await?
                .map_err(|error| std::io::Error::other(format!("{error:#}")))?;
                server::NativeServer::start(domain).await
            })?;
            app.manage(Shell {
                client: client.clone(),
                _server: server,
            });
            if std::env::var("STUDY_DISABLE_WORKERS").as_deref() != Ok("1") {
                let measuring = client.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = measuring.call_bytes("MeasureMachineOnce", &[]).await {
                        tracing::warn!(message = %error.message, "initial machine measurement unavailable");
                    }
                });
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Events only invalidate queries. Reconnecting always refreshes persisted
                // state, and the frontend also refreshes after its own mutations.
                loop {
                    match client.events().await {
                        Ok(mut events) => {
                            let _ = handle.emit("study://refresh", ());
                            while let Ok(Some(_)) = events.message().await {
                                let _ = handle.emit("study://refresh", ());
                            }
                        }
                        Err(error) => {
                            tracing::warn!(message=%error.message, "event subscription unavailable")
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            });
            #[cfg(debug_assertions)]
            if std::env::var("STUDY_DEVTOOLS").as_deref() == Ok("1")
                && let Some(window) = app.get_webview_window("main") { window.open_devtools(); }

            Ok(())
        })
        .on_page_load(|_webview, payload| {
            tracing::debug!(scheme = payload.url().scheme(), host = payload.url().host_str().unwrap_or_default(), event = ?payload.event(), "desktop page load");
            #[cfg(debug_assertions)]
            if std::env::var("STUDY_DEVTOOLS").as_deref() == Ok("1") { _webview.open_devtools(); }
        })
        .invoke_handler(tauri::generate_handler![
            rpc,
            close_window,
            quit_app,
            dialogs::pick_files,
            dialogs::pick_export,
            dialogs::open_external,
            dialogs::save_file,
            staging::stage_file,
            staging::release_files,
            updates::check_update,
            updates::install_update,
            updates::update_status,
            audio::recording_start,
            audio::recording_stop,
            audio::recording_send,
            audio::recording_discard,
            audio::recording_ack,
            audio::recording_status
        ])
        .build(tauri::generate_context!());
    match result {
        Ok(application) => application.run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // An accepted updater owns its task even if its webview waiter disappears.
                tauri::async_runtime::block_on(app.state::<updates::PendingUpdate>().shutdown());
                let microphone = app.state::<audio::Microphone>();
                if let Err(error) = tauri::async_runtime::block_on(microphone.shutdown()) {
                    tracing::warn!(message = %error.message, "microphone shutdown failed");
                }
                let shell = app.state::<Shell>();
                if let Err(error) = tauri::async_runtime::block_on(shell._server.shutdown()) {
                    tracing::error!(error = format!("{error:#}"), "native RPC shutdown failed");
                }
            }
        }),
        Err(error) => {
            tracing::error!(%error, "desktop failed");
            std::process::exit(1);
        }
    }
}
