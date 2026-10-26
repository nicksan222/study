use super::*;
use crate::{rpc::RpcClient, server::NativeServer};
use prost::Message as _;
use std::time::Duration;
use study_rpc::v1 as p;

async fn fixture() -> (tempfile::TempDir, study_app::App, NativeServer, RpcClient) {
    let dir = tempfile::tempdir().unwrap();
    let app = study_app::App::open(dir.path().join("study.sqlite3")).unwrap();
    let (server, client) = NativeServer::start(app.clone()).await.unwrap();
    (dir, app, server, client)
}
#[tokio::test(flavor = "multi_thread")]
async fn abandoned_install_owns_reservation_rejects_writes_and_launch_failure_recovers() {
    let (_dir, app, server, client) = fixture().await;
    let mut events = client.events().await.unwrap();
    assert!(events.message().await.unwrap().is_some());
    let pending = PendingUpdate::default();
    let mic = Microphone::default();
    let reserve = pending.reserve(&mic, &server.lifecycle()).unwrap();
    let (release, download) = tokio::sync::oneshot::channel();
    let (entered, seen) = tokio::sync::oneshot::channel();
    let check_pending = pending.clone();
    let check_mic = mic.clone();

    let caller = tokio::spawn(async move {
        launch_install(
            reserve,
            async move {
                entered.send(()).unwrap();
                download.await.unwrap();
                Ok(vec![1, 2, 3])
            },
            move |bytes, drained| {
                assert_eq!(bytes, [1, 2, 3]);
                before_windows_exit(&drained);
                assert!(check_pending.status().installing);
                assert!(check_mic.reserve_install().is_err());
                // Windows calls this before ShellExecute: resources remain live and a
                // failed launch must return to the same service, not a stopped server.

                Err(RpcError::internal("controlled ShellExecute failure"))
            },
        )
        .await
    });
    seen.await.unwrap();
    caller.abort();
    let _ = caller.await;
    assert!(
        pending.status().installing,
        "route/caller unmount released installation"
    );
    assert!(pending.begin_check().is_err());
    assert!(pending.reserve(&mic, &server.lifecycle()).is_err());
    let payload = p::CreateProjectRequest {
        name: "blocked".into(),
    }
    .encode_to_vec();
    let error = client
        .call_bytes("CreateProject", &payload)
        .await
        .unwrap_err();
    assert_eq!(error.code, tonic::Code::FailedPrecondition as i32);
    assert!(mic.rpc(&client, "CreateProject", &payload).await.is_err());
    assert!(app.projects().unwrap().is_empty());
    let mut waiting = tokio::spawn({
        let pending = pending.clone();
        async move { pending.wait_idle().await }
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut waiting)
            .await
            .is_err()
    );
    release.send(()).unwrap();
    waiting.await.unwrap();
    assert!(!pending.status().installing);
    assert!(mic.reserve_install().is_ok());
    client.call_bytes("CreateProject", &payload).await.unwrap();
    assert_eq!(app.projects().unwrap().len(), 1);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), events.message())
            .await
            .unwrap()
            .unwrap()
            .is_some(),
        "pause killed the existing subscription"
    );
    server.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn download_failure_reopens_admission_without_entering_installer() {
    let (_dir, _app, server, client) = fixture().await;
    let pending = PendingUpdate::default();
    let mic = Microphone::default();
    let reserve = pending.reserve(&mic, &server.lifecycle()).unwrap();
    let error = launch_install(
        reserve,
        async { Err(RpcError::internal("controlled download failure")) },
        |_, _| panic!("download failure entered installer"),
    )
    .await
    .unwrap_err();
    assert_eq!(error.message, "controlled download failure");
    assert!(!pending.status().installing);
    assert!(mic.reserve_install().is_ok());
    client.call_bytes("Projects", &[]).await.unwrap();
    server.shutdown().await.unwrap();
}
#[tokio::test]
async fn ready_restart_does_not_deadlock_exit_but_keeps_admission_closed() {
    let pending = PendingUpdate::default();
    let mic = Microphone::default();
    let lifecycle = Lifecycle::default();
    let reservation = pending.reserve(&mic, &lifecycle).unwrap();
    reservation.pause.as_ref().unwrap().drain().await;
    pending.ready_for_exit();
    tokio::time::timeout(Duration::from_millis(30), pending.wait_idle())
        .await
        .unwrap();
    assert!(pending.status().installing);
    assert!(mic.reserve_install().is_err());
    assert!(lifecycle.pause().is_err());
    drop(reservation);
}
#[test]
fn windows_pre_exit_adapter_refuses_an_unarmed_installation() {
    let drained = AtomicBool::new(false);
    assert!(std::panic::catch_unwind(|| before_windows_exit(&drained)).is_err());
    drained.store(true, Ordering::Release);
    before_windows_exit(&drained);
}
#[test]
fn absent_update_does_not_pause_or_cancel_other_application_work() {
    let pending = PendingUpdate::default();
    let mic = Microphone::default();
    let lifecycle = Lifecycle::default();
    assert!(pending.take_for_install(&mic, &lifecycle).is_err());
    assert!(!pending.status().installing);
    assert!(mic.reserve_install().is_ok());
    assert!(lifecycle.pause().is_ok());
}
#[test]
fn bundled_configuration_initializes_the_updater_without_a_development_key() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let updater = config["plugins"]["updater"].clone();
    let _: tauri_plugin_updater::Config = serde_json::from_value(updater).unwrap();
}

#[test]
fn controlled_windows_direct_exit_needs_no_post_install_continuation() {
    let dir = tempfile::tempdir().unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "updates::tests::controlled_windows_direct_exit_child",
            "--nocapture",
        ])
        .env("STUDY_CONTROLLED_UPDATER_EXIT", dir.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        std::fs::read(dir.path().join("drained-before-exit")).unwrap(),
        b"ready"
    );
    assert!(
        !dir.path().join("after-install").exists(),
        "test did not exercise direct exit"
    );
    let app = study_app::App::open(dir.path().join("study.sqlite3")).unwrap();
    assert_eq!(app.projects().unwrap()[0].name, "saved before installer");
}
#[tokio::test(flavor = "multi_thread")]
async fn controlled_windows_direct_exit_child() {
    let Some(dir) = std::env::var_os("STUDY_CONTROLLED_UPDATER_EXIT") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    let app = study_app::App::open(dir.join("study.sqlite3")).unwrap();
    let (server, client) = NativeServer::start(app).await.unwrap();
    client
        .call_bytes(
            "CreateProject",
            &p::CreateProjectRequest {
                name: "saved before installer".into(),
            }
            .encode_to_vec(),
        )
        .await
        .unwrap();
    let mic = Microphone::default();
    let pending = PendingUpdate::default();
    let reservation = pending.reserve(&mic, &server.lifecycle()).unwrap();
    let after = dir.join("after-install");
    launch_install(reservation, async { Ok(vec![]) }, move |_, drained| {
        // Controlled replacement for the locked Windows plugin's hook + direct exit.
        before_windows_exit(&drained);
        assert!(pending.status().installing);
        assert!(mic.reserve_install().is_err());
        assert!(server.lifecycle().pause().is_err());
        std::fs::write(dir.join("drained-before-exit"), b"ready").unwrap();
        std::process::exit(0);
    })
    .await
    .unwrap();
    std::fs::write(after, b"unexpected").unwrap();
}

#[test]
fn superseded_checks_cannot_publish_or_retarget_an_active_install() {
    let pending = PendingUpdate::default();
    let first = pending.begin_check().unwrap();
    let second = pending.begin_check().unwrap();
    assert!(pending.checked(first, None).is_err());
    pending.checked(second, None).unwrap();
    let mic = Microphone::default();
    let lifecycle = Lifecycle::default();
    let reservation = pending.reserve(&mic, &lifecycle).unwrap();
    assert!(pending.begin_check().is_err());
    assert!(pending.checked(second, None).is_err());
    assert!(pending.status().installing);
    drop(reservation);
    assert!(pending.begin_check().is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn quit_cancels_download_and_joins_owner_without_entering_installer() {
    let pending = PendingUpdate::default();
    let mic = Microphone::default();
    let lifecycle = Lifecycle::default();
    let reservation = pending.reserve(&mic, &lifecycle).unwrap();
    let (entered, seen) = tokio::sync::oneshot::channel();
    let caller = tokio::spawn(launch_install(
        reservation,
        async move {
            entered.send(()).unwrap();
            std::future::pending::<Result<Vec<u8>, RpcError>>().await
        },
        |_, _| panic!("quit entered installer"),
    ));
    seen.await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), pending.shutdown())
        .await
        .unwrap();
    assert_eq!(
        caller.await.unwrap().unwrap_err().code,
        tonic::Code::Cancelled as i32
    );
    assert!(!pending.status().installing);
    assert!(pending.reserve(&mic, &lifecycle).is_err());
    assert!(pending.begin_check().is_err());
    assert!(mic.reserve_install().is_ok());
    assert!(lifecycle.pause().is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn quit_joins_an_already_entered_blocking_installer_before_releasing_fences() {
    let pending = PendingUpdate::default();
    let mic = Microphone::default();
    let lifecycle = Lifecycle::default();
    let reservation = pending.reserve(&mic, &lifecycle).unwrap();
    let (entered, seen) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let caller = tokio::spawn(launch_install(
        reservation,
        async { Ok(vec![]) },
        move |_, drained| {
            before_windows_exit(&drained);
            entered.send(()).unwrap();
            wait.recv().unwrap();
            Err(RpcError::internal(
                "controlled installer failure during quit",
            ))
        },
    ));
    seen.await.unwrap();
    let mut quitting = tokio::spawn({
        let pending = pending.clone();
        async move { pending.shutdown().await }
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut quitting)
            .await
            .is_err()
    );
    assert!(pending.status().installing);
    assert!(mic.reserve_install().is_err());
    assert!(lifecycle.pause().is_err());
    release.send(()).unwrap();
    caller.await.unwrap().unwrap_err();
    quitting.await.unwrap();
    assert!(!pending.status().installing);
}
