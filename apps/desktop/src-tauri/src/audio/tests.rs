use super::*;
use std::sync::mpsc;
struct Fixture {
    app: study_app::App,
    server: study_app::rpc::Embedded,
    sink: AudioSink,
    session: SessionId,
    project: ProjectId,
    _dir: tempfile::TempDir,
}
impl Fixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let app = study_app::App::open(dir.path().join("study.sqlite3")).unwrap();
        let project = app.create_project("Biology").unwrap().id;
        let session = app.create_session(project, "Lecture").unwrap().id;
        let server = study_app::rpc::Embedded::start(app.clone(), true)
            .await
            .unwrap();
        let channel =
            tonic::transport::Endpoint::from_shared(format!("http://{}", server.address()))
                .unwrap()
                .connect()
                .await
                .unwrap();
        let sink = AudioSink::new(RpcClient::new(channel, server.token()).unwrap());
        Self {
            app,
            server,
            sink,
            session,
            project,
            _dir: dir,
        }
    }
    fn device(&self, samples: Vec<i16>) -> (Microphone, Arc<Mutex<Vec<mpsc::Sender<Ended>>>>) {
        let controls = Arc::new(Mutex::new(Vec::new()));
        let devices = controls.clone();
        let mic = Microphone::with_factory(Arc::new(move |sink, r| {
            let (send, receive) = mpsc::channel();
            devices.lock().unwrap().push(send);
            Ok(Recorder::controlled(sink, r, receive, samples.clone()))
        }));
        (mic, controls)
    }
    async fn close(self) {
        self.server.shutdown().await.unwrap();
    }
}
async fn idle(mic: &Microphone) -> RecordingStatus {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let mut changed = mic.0.changed.subscribe();
        loop {
            let status = mic.status();
            if status.phase == Phase::Idle {
                return status;
            }
            changed.changed().await.unwrap();
        }
    })
    .await
    .unwrap()
}
#[tokio::test(flavor = "multi_thread")]
async fn stop_joins_flushes_and_posts_once_to_the_recordings_owning_session() {
    let f = Fixture::new().await;
    let other = f.app.create_session(f.project, "Another route").unwrap();
    let (mic, _controls) = f.device(vec![-32768, 0, 32767]);
    let status = mic.start(f.sink.clone(), f.session, None).await.unwrap();
    assert_eq!(status.phase, Phase::Live);
    let recording = RecordingId::new(status.recording_id.unwrap().parse().unwrap());
    let stopped = mic.stop().await.unwrap();
    assert_eq!(stopped.events.last().unwrap().kind, Outcome::Posted);
    assert!(f.app.recording(recording).unwrap().is_none());
    assert!(f.app.messages(other.id).unwrap().is_empty());
    let messages = f.app.messages(f.session).unwrap();
    assert_eq!(messages.len(), 1);
    let source = messages[0].parts[0].content.source_id.unwrap();
    let mut wav = Vec::new();
    f.app.export_source(source, &mut wav).unwrap();
    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(&wav[wav.len() - 6..], &[0, 128, 0, 0, 255, 127]);
    mic.stop().await.unwrap();
    assert_eq!(f.app.messages(f.session).unwrap().len(), 1);
    f.close().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn full_posts_automatically_failure_retains_audio_and_events_survive_another_start() {
    let f = Fixture::new().await;
    let (mic, controls) = f.device(vec![42, 43]);
    mic.start(f.sink.clone(), f.session, None).await.unwrap();
    controls.lock().unwrap()[0].send(Ended::Full).unwrap();
    let full = idle(&mic).await;
    assert_eq!(full.events.last().unwrap().kind, Outcome::Full);
    assert_eq!(f.app.messages(f.session).unwrap().len(), 1);
    mic.start(f.sink.clone(), f.session, None).await.unwrap();
    assert_eq!(mic.status().events.len(), 1);
    controls.lock().unwrap()[1]
        .send(Ended::Failed(study_core::err!("device removed")))
        .unwrap();
    let failed = idle(&mic).await;
    assert_eq!(failed.events.len(), 2);
    assert_eq!(failed.events[1].kind, Outcome::Failed);
    assert_eq!(f.app.recordings().unwrap()[0].samples, 2);
    assert_eq!(f.app.messages(f.session).unwrap().len(), 1);
    let ack = failed.events[0].id.parse().unwrap();
    assert_eq!(mic.acknowledge(ack).events.len(), 1);
    let recording = f.app.recordings().unwrap()[0].id;
    mic.unfinished(f.sink.clone(), recording, false)
        .await
        .unwrap();
    assert_eq!(f.app.messages(f.session).unwrap().len(), 2);
    assert!(f.app.recordings().unwrap().is_empty());
    f.close().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn empty_recordings_are_deleted_and_unfinished_discard_is_real_rpc() {
    let f = Fixture::new().await;
    let (mic, _controls) = f.device(vec![]);
    mic.start(f.sink.clone(), f.session, None).await.unwrap();
    let stopped = mic.stop().await.unwrap();
    assert_eq!(stopped.events[0].kind, Outcome::Empty);
    assert!(f.app.recordings().unwrap().is_empty());
    assert!(f.app.messages(f.session).unwrap().is_empty());
    let saved = f.app.create_recording(f.session).unwrap();
    f.app.append_recording(saved.id, &[1, 2]).unwrap();
    mic.unfinished(f.sink.clone(), saved.id, true)
        .await
        .unwrap();
    assert!(f.app.recording(saved.id).unwrap().is_none());
    f.close().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn microphone_open_failure_cleans_new_empty_row_but_preserves_resumed_audio() {
    let f = Fixture::new().await;
    let mic = Microphone::with_factory(Arc::new(|_, _| Err(study_core::err!("no microphone"))));
    mic.start(f.sink.clone(), f.session, None).await.unwrap();
    assert!(f.app.recordings().unwrap().is_empty());
    let saved = f.app.create_recording(f.session).unwrap();
    f.app.append_recording(saved.id, &[9]).unwrap();
    mic.start(f.sink.clone(), f.session, Some(saved.id))
        .await
        .unwrap();
    assert_eq!(f.app.recording(saved.id).unwrap().unwrap().samples, 1);
    assert_eq!(mic.status().events.len(), 2);
    f.close().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn destructive_ipc_is_rejected_during_every_owned_phase_even_while_gate_is_held() {
    let f = Fixture::new().await;
    let saved = f.app.create_recording(f.session).unwrap();
    let mic = Microphone::default();
    for phase in [
        Phase::Starting,
        Phase::Live,
        Phase::Stopping,
        Phase::Posting,
        Phase::Sending,
        Phase::Discarding,
    ] {
        mic.change(|s| {
            s.phase = phase;
            s.owner = Owner {
                recording: Some(saved.id),
                session: Some(f.session),
                project: Some(f.project),
            };
        });
        let _held = mic.0.gate.lock().await;
        for (method, payload) in [
            (
                "DeleteSession",
                p::SessionId {
                    value: f.session.get(),
                }
                .encode_to_vec(),
            ),
            (
                "DeleteProject",
                p::ProjectId {
                    value: f.project.get(),
                }
                .encode_to_vec(),
            ),
            (
                "DeleteRecording",
                p::RecordingId {
                    value: saved.id.get(),
                }
                .encode_to_vec(),
            ),
            (
                "PostRecording",
                p::PostRecordingRequest {
                    session: Some(p::SessionId {
                        value: f.session.get(),
                    }),
                    recording: Some(p::RecordingId {
                        value: saved.id.get(),
                    }),
                    name: "audio.wav".into(),
                }
                .encode_to_vec(),
            ),
        ] {
            let result = tokio::time::timeout(
                std::time::Duration::from_millis(50),
                mic.rpc(&f.sink.client, method, &payload),
            )
            .await;
            assert!(
                result.is_ok(),
                "{phase:?} queued destructive {method} behind audio"
            );
            assert!(result.unwrap().is_err());
        }
    }
    assert!(f.app.recording(saved.id).unwrap().is_some());
    f.close().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn shutdown_during_start_joins_device_and_post_before_returning() {
    let f = Fixture::new().await;
    let (entered, seen) = tokio::sync::oneshot::channel();
    let entered = Mutex::new(Some(entered));
    let (release, wait) = mpsc::channel();
    let wait = Mutex::new(wait);
    let mic = Microphone::with_factory(Arc::new(move |sink, r| {
        if let Some(send) = entered.lock().unwrap().take() {
            let _ = send.send(());
        }
        wait.lock().unwrap().recv().unwrap();
        let (_send, receive) = mpsc::channel();
        Ok(Recorder::controlled(sink, r, receive, vec![5, 6]))
    }));
    let start = tokio::spawn({
        let mic = mic.clone();
        let sink = f.sink.clone();
        let session = f.session;
        async move { mic.start(sink, session, None).await }
    });
    seen.await.unwrap();
    assert_eq!(mic.status().phase, Phase::Starting);
    let mut stop = tokio::spawn({
        let mic = mic.clone();
        async move { mic.shutdown().await }
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut stop)
            .await
            .is_err()
    );
    release.send(()).unwrap();
    start.await.unwrap().unwrap();
    stop.await.unwrap().unwrap();
    assert_eq!(mic.status().phase, Phase::Idle);
    assert_eq!(f.app.messages(f.session).unwrap().len(), 1);
    assert!(f.app.recordings().unwrap().is_empty());
    assert!(mic.start(f.sink.clone(), f.session, None).await.is_err());
    f.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn telemetry_updates_are_bounded_by_the_tick_and_do_not_self_wake() {
    let f = Fixture::new().await;
    let (mic, _controls) = f.device(vec![]);
    mic.start(f.sink.clone(), f.session, None).await.unwrap();
    let before = mic.status().revision.parse::<u64>().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(140)).await;
    let after = mic.status().revision.parse::<u64>().unwrap();
    assert!(
        after - before <= 10,
        "telemetry self-woke {} times",
        after - before
    );
    mic.stop().await.unwrap();
    f.close().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn a_post_failure_retains_saved_audio_and_can_be_sent_once_after_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let app = study_app::App::open(dir.path().join("study.sqlite3")).unwrap();
    let project = app.create_project("Biology").unwrap();
    let session = app.create_session(project.id, "Lecture").unwrap();
    let server = study_app::rpc::Embedded::start(app.clone(), false)
        .await
        .unwrap();
    let channel = tonic::transport::Endpoint::from_shared(format!("http://{}", server.address()))
        .unwrap()
        .connect()
        .await
        .unwrap();
    let sink = AudioSink::new(RpcClient::new(channel, server.token()).unwrap());
    let mic = Microphone::with_factory(Arc::new(|sink, r| {
        let (_send, receive) = mpsc::channel();
        Ok(Recorder::controlled(sink, r, receive, vec![1, 2, 3]))
    }));
    mic.start(sink.clone(), session.id, None).await.unwrap();
    let status = mic.stop().await.unwrap();
    assert_eq!(status.events.last().unwrap().kind, Outcome::SaveFailed);
    assert!(app.messages(session.id).unwrap().is_empty());
    let saved = app.recordings().unwrap().pop().unwrap();
    assert_eq!(saved.samples, 3);
    app.start_workers_with(study_app::WorkerSetup::testing(
        study_app::pipeline::ExtractorSet::new(vec![]),
    ))
    .unwrap();
    mic.unfinished(sink, saved.id, false).await.unwrap();
    assert_eq!(app.messages(session.id).unwrap().len(), 1);
    assert!(app.recordings().unwrap().is_empty());
    server.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn stale_send_and_discard_clicks_are_idempotent_after_a_successful_post() {
    let f = Fixture::new().await;
    let saved = f.app.create_recording(f.session).unwrap();
    f.app.append_recording(saved.id, &[8, 9]).unwrap();
    let mic = Microphone::default();
    mic.unfinished(f.sink.clone(), saved.id, false)
        .await
        .unwrap();
    mic.unfinished(f.sink.clone(), saved.id, false)
        .await
        .unwrap();
    mic.unfinished(f.sink.clone(), saved.id, true)
        .await
        .unwrap();
    assert_eq!(f.app.messages(f.session).unwrap().len(), 1);
    assert!(
        !mic.status()
            .events
            .iter()
            .any(|e| e.kind == Outcome::SaveFailed)
    );
    f.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn update_reservation_is_atomic_with_every_capture_operation_phase() {
    let f = Fixture::new().await;
    let (mic, _) = f.device(vec![]);
    for phase in [
        Phase::Starting,
        Phase::Live,
        Phase::Stopping,
        Phase::Posting,
        Phase::Sending,
        Phase::Discarding,
    ] {
        mic.change(|s| s.phase = phase);
        assert!(mic.reserve_install().is_err(), "{phase:?}");
    }
    mic.change(|s| s.phase = Phase::Idle);
    let install = mic.reserve_install().unwrap();
    assert!(mic.start(f.sink.clone(), f.session, None).await.is_err());
    assert!(
        mic.unfinished(f.sink.clone(), RecordingId::new(1), false)
            .await
            .is_err()
    );
    drop(install);
    mic.start(f.sink.clone(), f.session, None).await.unwrap();
    assert!(mic.reserve_install().is_err());
    mic.stop().await.unwrap();
    f.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn raced_capture_start_and_install_have_exactly_one_owner() {
    let f = Fixture::new().await;
    let (mic, _controls) = f.device(vec![]);
    for _ in 0..20 {
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let recording = tokio::spawn({
            let mic = mic.clone();
            let sink = f.sink.clone();
            let barrier = barrier.clone();
            let session = f.session;
            async move {
                barrier.wait().await;
                mic.start(sink, session, None).await
            }
        });
        let install = tokio::spawn({
            let mic = mic.clone();
            async move {
                barrier.wait().await;
                mic.reserve_install()
            }
        });
        let recording = recording.await.unwrap();
        let install = install.await.unwrap();
        assert_ne!(
            recording.is_ok(),
            install.is_ok(),
            "capture and installer both reserved"
        );
        drop(install);
        mic.stop().await.unwrap();
    }
    f.close().await;
}
