//! Admission and ownership across HTTP/2 connections, request tasks and blocking commits.
use std::{
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::{
    sync::CancellationToken,
    task::{TaskTracker, task_tracker::TaskTrackerToken},
};
use tonic::Status;

/// Shared shutdown boundary, retained before moving Service into a transport.
/// Stop is synchronous and closes admission; drain closes accepted HTTP/2 connections and
/// awaits every already-admitted blocking commit. Dropping a request cannot detach a write.
#[derive(Clone, Default)]
pub struct Lifecycle(Arc<Inner>);
#[derive(Default)]
struct Inner {
    admission: Mutex<Admission>,
    stop: CancellationToken,
    force: CancellationToken,
    io: TaskTracker,
    work: TaskTracker,
}
#[derive(Default)]
struct Admission {
    paused: bool,
    interrupt: CancellationToken,
}
impl Lifecycle {
    /// Reject further admission and cancel subscriptions/auth/download waits immediately.
    pub fn stop(&self) {
        let _lock = self.0.admission.lock().unwrap_or_else(|e| e.into_inner());
        self.0.stop.cancel();
        self.0.work.close();
        self.0.io.close();
    }
    /// Drain responsive connections, force-close stalled bodies/streams after 200ms, and
    /// join all owned work. Started synchronous SQLite/OS calls must finish before return;
    /// aborting spawn_blocking would falsely declare a live commit cancelled.
    pub async fn drain(&self) {
        self.stop();
        if tokio::time::timeout(Duration::from_millis(200), self.0.io.wait())
            .await
            .is_err()
        {
            self.0.force.cancel();
        }
        self.0.io.wait().await;
        self.0.work.wait().await;
    }
    pub(super) fn force_close(&self) {
        self.stop();
        self.0.force.cancel();
    }
    pub(super) fn check(&self) -> Result<(), Status> {
        if self.0.stop.is_cancelled() {
            Err(super::classified(
                study_core::ErrorKind::Cancelled,
                "RPC service stopped",
            ))
        } else {
            Ok(())
        }
    }
    /// Reversibly close request admission while retaining the listener and connections.
    /// Already-admitted effects finish normally; cancellable auth/model waits end. Event
    /// streams and the transport remain live. Drop reopens admission unless stopped.
    pub fn pause(&self) -> Result<Pause, Status> {
        let mut paused = self.0.admission.lock().unwrap_or_else(|e| e.into_inner());
        self.check()?;
        if paused.paused {
            return Err(super::classified(
                study_core::ErrorKind::Config,
                "RPC service paused",
            ));
        }
        paused.paused = true;
        paused.interrupt.cancel();
        self.0.work.close();
        Ok(Pause {
            lifecycle: self.clone(),
        })
    }
    pub(super) fn check_admission(&self) -> Result<(), Status> {
        let paused = self.0.admission.lock().unwrap_or_else(|e| e.into_inner());
        self.check()?;
        if paused.paused {
            return Err(super::classified(
                study_core::ErrorKind::Config,
                "RPC service paused",
            ));
        }
        Ok(())
    }
    pub(super) fn admit(&self) -> Result<TaskTrackerToken, Status> {
        let paused = self.0.admission.lock().unwrap_or_else(|e| e.into_inner());
        self.check()?;
        if paused.paused {
            return Err(super::classified(
                study_core::ErrorKind::Config,
                "RPC service paused",
            ));
        }
        Ok(self.0.work.token())
    }
    /// Cancellable external waits end on pause as well as shutdown. Connections stay live.
    pub(super) async fn interrupted(&self) {
        let interrupt = self
            .0
            .admission
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .interrupt
            .clone();
        tokio::select! {biased; _=self.0.stop.cancelled()=>{}, _=interrupt.cancelled()=>{}}
    }
    pub(super) async fn cancelled(&self) {
        self.0.stop.cancelled().await;
    }
    pub(super) fn spawn_io(&self, future: impl Future<Output = ()> + Send + 'static) {
        let _lock = self.0.admission.lock().unwrap_or_else(|e| e.into_inner());
        if self.0.stop.is_cancelled() {
            return;
        }
        let stop = self.0.force.clone();
        self.0.io.spawn(async move {
            tokio::select! {biased;_=stop.cancelled()=>{},_=future=>{}}
        });
    }
}
/// Owned reversible admission reservation. Keep it alive through an installer/direct exit.
pub struct Pause {
    lifecycle: Lifecycle,
}
impl Pause {
    /// Join effects accepted before the pause, including abandoned IPC requests.
    pub async fn drain(&self) {
        self.lifecycle.0.work.wait().await;
    }
}
impl Drop for Pause {
    fn drop(&mut self) {
        let mut paused = self
            .lifecycle
            .0
            .admission
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        paused.paused = false;
        paused.interrupt = CancellationToken::new();
        if !self.lifecycle.0.stop.is_cancelled() {
            self.lifecycle.0.work.reopen();
        }
    }
}
/// Hyper uses its executor for individual HTTP/2 stream tasks too. Using TokioExecutor
/// here would detach exactly the accepted streams this lifecycle must be able to join.
#[derive(Clone)]
pub(super) struct Executor(pub Lifecycle);
impl<F> hyper::rt::Executor<F> for Executor
where
    F: Future<Output = ()> + Send + 'static,
{
    fn execute(&self, future: F) {
        self.0.spawn_io(future);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(flavor = "multi_thread")]
    async fn dropped_request_cannot_detach_an_already_started_blocking_commit() {
        let dir = tempfile::tempdir().unwrap();
        let app = crate::App::open(dir.path().join("study.sqlite3")).unwrap();
        let service = super::super::Service::test(app.clone());
        let lifecycle = service.lifecycle();
        let (entered, seen) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let request = tokio::spawn(async move {
            service
                .run(true, move |s| {
                    let _ = entered.send(());
                    wait.recv().unwrap();
                    super::super::outcome(s.app.create_project("admitted before stop"))
                })
                .await
        });
        seen.await.unwrap();
        request.abort();
        let _ = request.await;
        lifecycle.stop();
        let mut drain = tokio::spawn({
            let lifecycle = lifecycle.clone();
            async move {
                lifecycle.drain().await;
            }
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(30), &mut drain)
                .await
                .is_err(),
            "shutdown abandoned a started write"
        );
        release.send(()).unwrap();
        drain.await.unwrap();
        assert_eq!(app.projects().unwrap().len(), 1);
        assert_eq!(
            lifecycle.check().unwrap_err().code(),
            tonic::Code::Cancelled
        );
        assert!(lifecycle.0.work.is_empty());
    }
    #[tokio::test(flavor = "multi_thread")]
    async fn pause_drains_admitted_and_deferred_effects_and_reopens_after_failure() {
        let dir = tempfile::tempdir().unwrap();
        let app = crate::App::open(dir.path().join("study.sqlite3")).unwrap();
        let service = super::super::Service::test(app.clone());
        let lifecycle = service.lifecycle();
        let (entered, seen) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let request = tokio::spawn({
            let service = service.clone();
            async move {
                service
                    .run(true, move |s| {
                        let _ = entered.send(());
                        wait.recv().unwrap();
                        let mut settings = super::super::outcome(s.load_app_settings())?;
                        settings.zoom_percent = 135;
                        s.store_app_settings(settings)?;
                        super::super::outcome(s.app.create_project("saved before install"))
                    })
                    .await
            }
        });
        seen.await.unwrap();
        let deferred = lifecycle.admit().unwrap();
        let pause = lifecycle.pause().unwrap();
        assert!(lifecycle.admit().is_err());
        assert!(lifecycle.check_admission().is_err());
        // A previously admitted blocking closure must NOT fail because admission paused.
        assert!(lifecycle.check().is_ok());
        request.abort();
        let _ = request.await;
        let drain = tokio::spawn(async move {
            pause.drain().await;
            pause
        });
        release.send(()).unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!drain.is_finished(), "deferred admitted effect was skipped");
        drop(deferred);
        let pause = drain.await.unwrap();
        assert_eq!(app.projects().unwrap().len(), 1);
        assert_eq!(service.load_app_settings().unwrap().zoom_percent, 135);
        assert!(service.run(true, |_| Ok(())).await.is_err());
        drop(pause);
        service
            .run(true, |s| {
                super::super::outcome(s.app.create_project("recovered"))
            })
            .await
            .unwrap();
        assert_eq!(app.projects().unwrap().len(), 2);
        let pause = lifecycle.pause().unwrap();
        lifecycle.stop();
        drop(pause);
        assert!(
            lifecycle.admit().is_err(),
            "pause release reopened permanent stop"
        );
    }
}
