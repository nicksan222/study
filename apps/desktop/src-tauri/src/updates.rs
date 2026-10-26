//! Signed updates own capture/RPC admission independently of the invoking webview.
//! Windows exits inside install(), so all work drains before entering that function.
use crate::{audio::Microphone, rpc::RpcError};
use serde::Serialize;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use study_app::rpc::Lifecycle;
use tauri_plugin_updater::{Update, UpdaterExt as _};
fn public_key(app: &tauri::AppHandle) -> Option<&str> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
}
#[derive(Default)]
struct State {
    update: Option<(Update, Arc<AtomicBool>)>,
    installing: bool,
    ready_for_exit: bool,
    shutting_down: bool,
    generation: u64,
}
#[derive(Clone)]
pub struct PendingUpdate {
    state: Arc<Mutex<State>>,
    changed: tokio::sync::watch::Sender<bool>,
}
impl Default for PendingUpdate {
    fn default() -> Self {
        Self {
            state: Arc::default(),
            changed: tokio::sync::watch::channel(false).0,
        }
    }
}
#[derive(Serialize)]
pub struct InstallationStatus {
    installing: bool,
}
impl PendingUpdate {
    fn status(&self) -> InstallationStatus {
        InstallationStatus {
            installing: self
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .installing,
        }
    }
    fn begin_check(&self) -> Result<u64, RpcError> {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if s.installing || s.shutting_down {
            return Err(RpcError::invalid("update installation in progress"));
        }
        s.generation += 1;
        s.update = None;
        Ok(s.generation)
    }
    fn checked(
        &self,
        generation: u64,
        update: Option<(Update, Arc<AtomicBool>)>,
    ) -> Result<(), RpcError> {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if s.installing || s.shutting_down || s.generation != generation {
            return Err(RpcError::invalid("update check was superseded"));
        }
        s.update = update;
        Ok(())
    }
    /// Exit can cancel network download, but joins any already-started installer/effect.
    pub async fn shutdown(&self) {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .shutting_down = true;
        self.changed.send_modify(|v| *v = !*v);
        self.wait_idle().await;
    }
    fn shutting_down(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .shutting_down
    }
    async fn cancelled(&self) {
        let mut changed = self.changed.subscribe();
        while !self.shutting_down() {
            if changed.changed().await.is_err() {
                break;
            }
        }
    }
    pub async fn wait_idle(&self) {
        let mut changed = self.changed.subscribe();
        loop {
            let waiting = {
                let s = self.state.lock().unwrap_or_else(|p| p.into_inner());
                s.installing && !s.ready_for_exit
            };
            if !waiting {
                break;
            }
            if changed.changed().await.is_err() {
                break;
            }
        }
    }
    fn ready_for_exit(&self) {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .ready_for_exit = true;
        self.changed.send_modify(|v| *v = !*v);
    }
    fn take_for_install(
        &self,
        microphone: &Microphone,
        lifecycle: &Lifecycle,
    ) -> Result<(Installation, Update, Arc<AtomicBool>), RpcError> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if state.update.is_none() {
            return Err(RpcError::invalid("check for an update before installing"));
        }
        let reservation = self.reserve_locked(&mut state, microphone, lifecycle)?;
        let (update, armed) = state
            .update
            .take()
            .expect("release selected under the installation lock");
        Ok((reservation, update, armed))
    }
    #[cfg(test)]
    fn reserve(
        &self,
        microphone: &Microphone,
        lifecycle: &Lifecycle,
    ) -> Result<Installation, RpcError> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        self.reserve_locked(&mut state, microphone, lifecycle)
    }
    fn reserve_locked(
        &self,
        s: &mut State,
        microphone: &Microphone,
        lifecycle: &Lifecycle,
    ) -> Result<Installation, RpcError> {
        if s.installing || s.shutting_down {
            return Err(RpcError::invalid("update installation in progress"));
        }
        let microphone = microphone.reserve_install()?;
        let pause = lifecycle.pause().map_err(RpcError::from)?;
        s.installing = true;
        s.ready_for_exit = false;
        self.changed.send_replace(true);
        Ok(Installation {
            pending: self.clone(),
            microphone: Some(microphone),
            pause: Some(pause),
        })
    }
}
struct Installation {
    pending: PendingUpdate,
    microphone: Option<crate::audio::InstallReservation>,
    pause: Option<study_app::rpc::Pause>,
}
impl Drop for Installation {
    fn drop(&mut self) {
        // Publish failure/recovery only after both admission fences have reopened.
        self.pause.take();
        self.microphone.take();
        self.pending
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .installing = false;
        self.pending.changed.send_replace(false);
    }
}
/// Replaces the plugin's destructive cleanup_before_exit hook. That hook runs BEFORE
/// ShellExecute can fail. Keep the window/resources intact on failure; process exit owns
/// OS cleanup on Windows success. No async runtime is blocked from this synchronous hook.
fn before_windows_exit(drained: &AtomicBool) {
    assert!(
        drained.load(Ordering::Acquire),
        "installer entered before application drain"
    );
}
async fn owned_install<D, I>(
    reservation: Installation,
    download: D,
    install: I,
) -> Result<(), RpcError>
where
    D: std::future::Future<Output = Result<Vec<u8>, RpcError>> + Send + 'static,
    I: FnOnce(Vec<u8>, Arc<AtomicBool>) -> Result<(), RpcError> + Send + 'static,
{
    // Download errors reopen the same live service. Admission remains paused while the
    // download runs, so a late capture or preference effect cannot race replacement.
    let cancelled = || {
        RpcError::from(tonic::Status::cancelled(
            "update cancelled by application exit",
        ))
    };
    let bytes = tokio::select! { biased;
        _=reservation.pending.cancelled()=>return Err(cancelled()),
        result=download=>result?,
    };
    reservation
        .pause
        .as_ref()
        .expect("installation owns pause")
        .drain()
        .await;
    if reservation.pending.shutting_down() {
        return Err(cancelled());
    }
    let drained = Arc::new(AtomicBool::new(true));
    tokio::task::spawn_blocking(move || {
        let _reservation = reservation;
        install(bytes, drained)
    })
    .await
    .map_err(|_| RpcError::internal("update installation task failed"))?
}
async fn launch_install<D, I>(
    reservation: Installation,
    download: D,
    install: I,
) -> Result<(), RpcError>
where
    D: std::future::Future<Output = Result<Vec<u8>, RpcError>> + Send + 'static,
    I: FnOnce(Vec<u8>, Arc<AtomicBool>) -> Result<(), RpcError> + Send + 'static,
{
    // Dropping the command future drops only this JoinHandle, never its owned operation.
    tokio::spawn(async move {
        let result = owned_install(reservation, download, install).await;
        if let Err(error) = &result {
            tracing::error!(message=%error.message,"update installation failed");
        }
        result
    })
    .await
    .map_err(|_| RpcError::internal("update operation failed"))?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    configured: bool,
    current_version: String,
    version: Option<String>,
    body: Option<String>,
}
fn configured(app: &tauri::AppHandle) -> bool {
    public_key(app).is_some_and(|key| !key.trim().is_empty())
        && (!cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some())
}
#[tauri::command]
pub fn update_status(pending: tauri::State<'_, PendingUpdate>) -> InstallationStatus {
    pending.status()
}
#[tauri::command]
pub async fn check_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<UpdateStatus, RpcError> {
    let generation = pending.begin_check()?;
    let mut result = UpdateStatus {
        configured: configured(&app),
        current_version: app.package_info().version.to_string(),
        version: None,
        body: None,
    };
    if !result.configured {
        return Ok(result);
    }
    // The hook only verifies a fence established asynchronously before install(). It
    // deliberately does not destroy Tauri resources before Windows launch succeeds.
    let armed = Arc::new(AtomicBool::new(false));
    let hook = armed.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || before_windows_exit(&hook))
        .build()
        .map_err(|e| RpcError::internal(e.to_string()))?;
    let update = updater
        .check()
        .await
        .map_err(|e| RpcError::internal(e.to_string()))?;
    if let Some(u) = &update {
        result.version = Some(u.version.clone());
        result.body = u.body.clone();
    }
    // Store the hook's shared flag with its exact Update, never a later check's target.
    pending.checked(generation, update.map(|u| (u, armed)))?;
    Ok(result)
}
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    microphone: tauri::State<'_, Microphone>,
    shell: tauri::State<'_, crate::Shell>,
) -> Result<(), RpcError> {
    // Selection, microphone reservation and service pause happen under one owner lock.
    let (reservation, update, armed) =
        pending.take_for_install(&microphone, &shell._server.lifecycle())?;
    let download = update.clone();
    let owner = pending.inner().clone();
    launch_install(
        reservation,
        async move {
            download
                .download(|_, _| {}, || {})
                .await
                .map_err(|e| RpcError::internal(e.to_string()))
        },
        move |bytes, drained| {
            before_windows_exit(&drained);
            armed.store(true, Ordering::Release);
            update
                .install(bytes)
                .map_err(|e| RpcError::internal(e.to_string()))?;
            // restart() waits forever on this blocking thread for RunEvent::Exit.
            // Let Exit drain the server without waiting for its own restart waiter.
            owner.ready_for_exit();
            app.restart();
        },
    )
    .await
}
#[cfg(test)]
mod tests;
