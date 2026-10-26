use std::path::Path;
use study_app::{
    App, WorkerSetup,
    rpc::{Embedded, Service},
};
use study_rpc::{
    tonic::{Code, Status},
    v1 as p,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;
fn app(path: &Path) -> App {
    App::open(path).unwrap()
}
fn empty() -> p::Empty {
    p::Empty {}
}
fn kind(error: &Status) -> p::ErrorKind {
    study_rpc::error_details(error).unwrap().kind()
}

#[tokio::test(flavor = "multi_thread")]
async fn library_sessions_recordings_settings_and_errors_survive_transport_restart() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("study.sqlite3");
    let server = Embedded::start(app(&path), true).await.unwrap();
    let mut client = server.client().await?;
    assert!(client.get_health(empty()).await?.into_inner().test_mode);
    let invalid = client
        .create_project(p::CreateProjectRequest { name: " ".into() })
        .await
        .unwrap_err();
    assert_eq!(
        (invalid.code(), kind(&invalid)),
        (Code::InvalidArgument, p::ErrorKind::InvalidInput)
    );
    let project = client
        .create_project(p::CreateProjectRequest {
            name: "  Biology  ".into(),
        })
        .await?
        .into_inner()
        .id
        .unwrap();
    client
        .set_exam(p::SetExamRequest {
            id: Some(project),
            exam_on: Some(p::Day {
                year: 2028,
                month: 2,
                day: 29,
            }),
        })
        .await?;
    let wrong = client
        .set_exam(p::SetExamRequest {
            id: Some(project),
            exam_on: Some(p::Day {
                year: 2026,
                month: 2,
                day: 29,
            }),
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&wrong), p::ErrorKind::InvalidInput);
    assert!(
        client
            .rename_project(p::RenameProjectRequest {
                id: Some(project),
                name: "Cells".into()
            })
            .await?
            .into_inner()
            .value
    );
    let empty_note = client
        .create_note(p::CreateNoteRequest {
            project: Some(project),
            title: "Empty".into(),
            text: "  ".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&empty_note), p::ErrorKind::InvalidInput);
    let note = client
        .create_note(p::CreateNoteRequest {
            project: Some(project),
            title: "Mitochondria".into(),
            text: "ATP powers cells".into(),
        })
        .await?
        .into_inner();
    let source = note.id.unwrap();
    assert_eq!(
        client.export_source(source).await?.into_inner().value,
        b"ATP powers cells"
    );
    let exported = dir.path().join("exported.md");
    std::fs::write(&exported, "replace this")?;
    let written = client
        .export_source_to_file(p::ExportSourceToFileRequest {
            source_id: Some(source),
            destination: exported.to_string_lossy().into(),
        })
        .await?
        .into_inner()
        .value;
    assert_eq!(written, b"ATP powers cells".len() as u64);
    assert_eq!(std::fs::read(&exported)?, b"ATP powers cells");
    assert!(
        client
            .source_document(source)
            .await?
            .into_inner()
            .value
            .is_none()
    );
    let imported = dir.path().join("lecture.txt");
    std::fs::write(&imported, "Ribosomes make proteins")?;
    let results = client
        .import_files(p::ImportFilesRequest {
            paths: vec![
                imported.to_string_lossy().into(),
                dir.path().join("absent.txt").to_string_lossy().into(),
            ],
            project: Some(project),
        })
        .await?
        .into_inner()
        .items;
    assert!(matches!(
        results[0].result,
        Some(p::import_outcome::Result::Source(_))
    ));
    assert!(matches!(
        results[1].result,
        Some(p::import_outcome::Result::Error(_))
    ));
    assert!(
        client
            .search(p::SearchRequest {
                query: "Mitochondria".into(),
                limit: 20
            })
            .await?
            .into_inner()
            .hits
            .iter()
            .any(|v| v.title == "Mitochondria")
    );
    let session = client
        .create_session(p::CreateSessionRequest {
            project: Some(project),
            title: "Lecture".into(),
        })
        .await?
        .into_inner()
        .id
        .unwrap();
    let recording = client
        .create_recording(session)
        .await?
        .into_inner()
        .id
        .unwrap();
    client
        .append_recording(p::AppendRecordingRequest {
            id: Some(recording),
            samples: vec![-32768, 0, 32767],
        })
        .await?;
    let bad = client
        .append_recording(p::AppendRecordingRequest {
            id: Some(recording),
            samples: vec![0, 32768],
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&bad), p::ErrorKind::InvalidInput);
    assert_eq!(
        client
            .recording(recording)
            .await?
            .into_inner()
            .value
            .unwrap()
            .samples,
        3
    );
    client
        .save_app_settings(p::AppSettings {
            language: p::Language::Italian as i32,
            appearance: p::Appearance::Light as i32,
            zoom_percent: 125,
            onboarded: true,
        })
        .await?;
    client
        .save_review_settings(p::ReviewSettings {
            new_cards_per_day: 7,
        })
        .await?;
    client
        .save_transcription_settings(p::TranscriptionSettings { local_instances: 2 })
        .await?;
    let invalid = client
        .save_transcription_settings(p::TranscriptionSettings { local_instances: 0 })
        .await
        .unwrap_err();
    assert_eq!(kind(&invalid), p::ErrorKind::InvalidInput);
    let processing = client.processing(empty()).await?.into_inner();
    let switch = processing.switches.first().unwrap();
    client
        .switch_processor(p::SwitchProcessorRequest {
            kind: switch.source,
            processor: switch.processor,
            on: !switch.on,
        })
        .await?;
    let err = client.start_workers(empty()).await.unwrap_err();
    assert_eq!(
        (err.code(), kind(&err)),
        (Code::FailedPrecondition, p::ErrorKind::Config)
    );
    let err = client
        .install_model(p::ModelRequest {
            model: p::LocalModel::Search as i32,
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&err), p::ErrorKind::Config);
    client
        .post_message(p::PostMessageRequest {
            place: Some(p::post_message_request::Place::Timeline(session)),
            text: "hello".into(),
            files: vec![],
        })
        .await?;
    assert!(
        !client
            .get_health(empty())
            .await?
            .into_inner()
            .workers_running
    );
    client
        .save_material_settings(p::MaterialSettings { sift: false })
        .await?;
    drop(client);
    server.shutdown().await.unwrap();
    let server = Embedded::start(app(&path), true).await.unwrap();
    let mut client = server.client().await?;
    assert!(
        !client
            .get_material_settings(empty())
            .await?
            .into_inner()
            .sift
    );
    let projects = client.projects(empty()).await?.into_inner().items;
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "Cells");
    assert_eq!(projects[0].exam_on.unwrap().year, 2028);
    assert_eq!(
        client
            .get_app_settings(empty())
            .await?
            .into_inner()
            .zoom_percent,
        125
    );
    assert_eq!(
        client
            .get_review_settings(empty())
            .await?
            .into_inner()
            .new_cards_per_day,
        7
    );
    assert_eq!(
        client
            .get_transcription_settings(empty())
            .await?
            .into_inner()
            .local_instances,
        2
    );
    assert_eq!(
        client
            .recording(recording)
            .await?
            .into_inner()
            .value
            .unwrap()
            .samples,
        3
    );
    assert!(client.delete_project(project).await?.into_inner().value);
    assert!(!client.delete_project(project).await?.into_inner().value);
    let retained = client.source(source).await?.into_inner().value.unwrap();
    assert!(retained.project_id.is_none());
    assert!(client.session(session).await?.into_inner().value.is_none());
    assert!(
        client
            .recording(recording)
            .await?
            .into_inner()
            .value
            .is_none()
    );
    drop(client);
    server.shutdown().await.unwrap();
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn auth_stream_hints_and_missing_entities_are_consumer_visible() -> TestResult {
    let dir = tempfile::tempdir()?;
    let server = Embedded::start(app(&dir.path().join("study.sqlite3")), true)
        .await
        .unwrap();
    let mut unauthenticated = study_rpc::connect_tcp(server.address()).await?;
    let err = unauthenticated.projects(empty()).await.unwrap_err();
    assert_eq!(
        (err.code(), kind(&err)),
        (Code::Unauthenticated, p::ErrorKind::Auth)
    );
    assert_eq!(
        unauthenticated.subscribe(empty()).await.unwrap_err().code(),
        Code::Unauthenticated
    );
    let mut client = server.client().await?;
    let mut stream = client.subscribe(empty()).await?.into_inner();
    assert!(matches!(
        stream.message().await?.unwrap().kind,
        Some(p::event::Kind::RefreshAll(_))
    ));
    client
        .create_project(p::CreateProjectRequest {
            name: "Physics".into(),
        })
        .await?;
    let hint = tokio::time::timeout(std::time::Duration::from_secs(2), stream.message()).await??;
    assert!(matches!(
        hint.unwrap().kind,
        Some(p::event::Kind::RefreshAll(_))
    ));
    assert_eq!(
        client.projects(empty()).await?.into_inner().items[0].name,
        "Physics"
    );
    assert!(
        client
            .source(p::SourceId { value: 999 })
            .await?
            .into_inner()
            .value
            .is_none()
    );
    let err = client
        .preview(p::SourceId { value: 999 })
        .await
        .unwrap_err();
    assert_eq!(kind(&err), p::ErrorKind::NotFound);
    let err = client.source(p::SourceId { value: 0 }).await.unwrap_err();
    assert_eq!(kind(&err), p::ErrorKind::InvalidInput);
    let err = client
        .search(p::SearchRequest {
            query: "x".into(),
            limit: u64::MAX,
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&err), p::ErrorKind::InvalidInput);
    drop(stream);
    drop(client);
    drop(unauthenticated);
    server.shutdown().await.unwrap();
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn messages_threads_versions_and_recording_posts_use_real_transport() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("study.sqlite3");
    let backend = app(&path);
    backend
        .start_workers_with(WorkerSetup::testing(
            study_app::pipeline::ExtractorSet::new(vec![]),
        ))
        .unwrap();
    let server = Embedded::start(backend, false).await.unwrap();
    let mut client = server.client().await?;
    let project = client
        .create_project(p::CreateProjectRequest {
            name: "Cells".into(),
        })
        .await?
        .into_inner()
        .id
        .unwrap();
    let session = client
        .create_session(p::CreateSessionRequest {
            project: Some(project),
            title: "Lecture".into(),
        })
        .await?
        .into_inner()
        .id
        .unwrap();
    let file = dir.path().join("cells.txt");
    std::fs::write(&file, "Mitochondria produce ATP")?;
    let message = client
        .post_message(p::PostMessageRequest {
            place: Some(p::post_message_request::Place::Timeline(session)),
            text: "Initial note".into(),
            files: vec![file.to_string_lossy().into()],
        })
        .await?
        .into_inner();
    let id = message.id.unwrap();
    let original = message.active_version.unwrap();
    let root = message.parts[0].id.unwrap();
    let edited = client
        .edit_message(p::EditMessageRequest {
            id: Some(id),
            text: "Corrected note".into(),
        })
        .await?
        .into_inner()
        .value
        .unwrap();
    assert_ne!(edited, original);
    assert!(
        client
            .set_active_version(p::SetActiveVersionRequest {
                message: Some(id),
                version: Some(original)
            })
            .await?
            .into_inner()
            .value
    );
    let thread_reply = client
        .post_message(p::PostMessageRequest {
            place: Some(p::post_message_request::Place::Thread(root)),
            text: "Thread note".into(),
            files: vec![],
        })
        .await?
        .into_inner();
    let thread = client.thread(root).await?.into_inner().value.unwrap();
    assert_eq!(thread.replies.len(), 1);
    assert_eq!(thread.replies[0].id, thread_reply.id);
    let timeline = client.messages(session).await?.into_inner().items;
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].versions.len(), 2);
    assert_eq!(timeline[0].active_version, Some(original));
    let recording = client
        .create_recording(session)
        .await?
        .into_inner()
        .id
        .unwrap();
    client
        .append_recording(p::AppendRecordingRequest {
            id: Some(recording),
            samples: vec![0; 160],
        })
        .await?;
    let posted = client
        .post_recording(p::PostRecordingRequest {
            session: Some(session),
            recording: Some(recording),
            name: "Lecture.wav".into(),
        })
        .await?
        .into_inner();
    let source = posted.parts[0].content.as_ref().unwrap().source_id.unwrap();
    let bytes = client.export_source(source).await?.into_inner().value;
    assert_eq!(&bytes[..4], b"RIFF");
    assert!(
        client
            .recording(recording)
            .await?
            .into_inner()
            .value
            .is_none()
    );
    assert!(client.delete_message(id).await?.into_inner().value);
    assert!(client.thread(root).await?.into_inner().value.is_none());
    drop(client);
    server.shutdown().await.unwrap();
    let reopened = app(&path);
    assert_eq!(
        reopened
            .messages(study_core::SessionId::new(session.value))
            .unwrap()
            .len(),
        1
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn typed_documents_material_reviews_practice_and_jobs_round_trip() -> TestResult {
    use study_core::{
        Anchor, ArtifactBody, ArtifactKind, Block, BlockKind, Document, Flashcard, PracticeBody,
        WrittenQuestion,
        db::{Database, MessageRole, NewPart},
    };
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("study.sqlite3");
    let db = Database::open(&path).unwrap();
    let project = db.create_project("Biology").unwrap();
    let session = db.create_session(project.id, "Cells").unwrap();
    let file = dir.path().join("cells.txt");
    std::fs::write(&file, "Mitochondria make ATP")?;
    let note = db
        .post_message(
            session.id,
            MessageRole::User,
            &[NewPart::Text("Notes about ATP".into()), NewPart::File(file)],
            &|_, _| false,
        )
        .unwrap();
    let source = note.parts[0].content.source_id.unwrap();
    db.save_document(
        source,
        &Document {
            blocks: vec![Block {
                kind: BlockKind::Paragraph,
                text: "Mitochondria make ATP".into(),
                anchor: Anchor::Text {
                    line_start: 1,
                    line_end: 1,
                    start: 0,
                    end: 21,
                },
            }],
            ..Document::default()
        },
    )
    .unwrap();
    let (artifact, _) = db
        .request_update(project.id, ArtifactKind::Flashcards, &[source])
        .unwrap();
    db.finish_artifact(
        artifact,
        &ArtifactBody::Flashcards {
            cards: vec![Flashcard {
                front: "ATP?".into(),
                back: "Energy".into(),
                cites: vec![],
            }],
        },
        &[],
    )
    .unwrap();
    let practice = db.project_practice(project.id).unwrap();
    let question = db.practice(practice).unwrap().unwrap().questions[0].id;
    db.finish_question(
        question,
        &WrittenQuestion {
            gist: "ATP production".into(),
            body: PracticeBody::Choice {
                question: "Where is ATP made?".into(),
                choices: vec!["Mitochondria".into(), "Nucleus".into()],
                answer: 0,
                explanation: "Powerhouse".into(),
                cites: vec![],
            },
        },
        &[],
    )
    .unwrap();
    drop(db);
    let server = Embedded::start(app(&path), true).await.unwrap();
    let mut client = server.client().await?;
    let source = p::SourceId {
        value: source.get(),
    };
    let project = p::ProjectId {
        value: project.id.get(),
    };
    let artifact = p::ArtifactId {
        value: artifact.get(),
    };
    let practice = p::PracticeId {
        value: practice.get(),
    };
    let document = client
        .source_document(source)
        .await?
        .into_inner()
        .value
        .unwrap();
    assert_eq!(document.blocks[0].text, "Mitochondria make ATP");
    assert!(matches!(
        document.blocks[0].anchor.as_ref().unwrap().kind,
        Some(p::anchor::Kind::Text(_))
    ));
    assert!(
        client
            .correct_block(p::CorrectBlockRequest {
                id: Some(source),
                ordinal: 0,
                before: "Mitochondria make ATP".into(),
                after: "Mitochondria synthesize ATP".into()
            })
            .await?
            .into_inner()
            .value
    );
    assert!(
        !client
            .correct_block(p::CorrectBlockRequest {
                id: Some(source),
                ordinal: 0,
                before: "stale".into(),
                after: "overwrite".into()
            })
            .await?
            .into_inner()
            .value
    );
    let artifact_body = client
        .artifact(artifact)
        .await?
        .into_inner()
        .value
        .unwrap()
        .body
        .unwrap();
    assert!(matches!(
        artifact_body.kind,
        Some(p::artifact_body::Kind::Flashcards(_))
    ));
    let due = client
        .due_cards(p::DueCardsRequest {
            project: Some(project),
            limit: 10,
        })
        .await?
        .into_inner()
        .items;
    assert_eq!(due.len(), 1);
    let card = due[0].card.as_ref().unwrap().id.unwrap();
    let memory = client
        .review(p::ReviewRequest {
            card: Some(card),
            rating: p::Rating::Good as i32,
        })
        .await?
        .into_inner()
        .value
        .unwrap();
    assert_eq!(memory.reps, 1);
    assert!(memory.stability > 0.0);
    assert_eq!(
        client
            .review_times(p::ReviewTimesRequest {
                project: Some(project),
                since: 0
            })
            .await?
            .into_inner()
            .items
            .len(),
        1
    );
    assert_eq!(
        client
            .due_count(p::OptionalProject {
                project: Some(project)
            })
            .await?
            .into_inner()
            .value,
        0
    );
    assert!(
        client
            .set_card(p::SetCardRequest {
                artifact: Some(artifact),
                index: 0,
                change: Some(p::set_card_request::Change::Write(p::WriteCard {
                    front: "ATP means?".into(),
                    back: "Adenosine triphosphate".into()
                }))
            })
            .await?
            .into_inner()
            .value
    );
    assert_eq!(client.material(project).await?.into_inner().items.len(), 1);
    assert!(
        client
            .material_changes(artifact)
            .await?
            .into_inner()
            .value
            .is_some()
    );
    let practiced = client.practice(practice).await?.into_inner().value.unwrap();
    assert!(matches!(
        practiced.questions[0]
            .written
            .as_ref()
            .unwrap()
            .body
            .as_ref()
            .unwrap()
            .kind,
        Some(p::practice_body::Kind::Choice(_))
    ));
    assert!(
        client
            .add_to_flashcards(p::AddToFlashcardsRequest {
                question: Some(p::QuestionId {
                    value: question.get()
                }),
                title: "Mistakes".into()
            })
            .await?
            .into_inner()
            .value
    );
    let jobs = client
        .job_overviews(p::LimitRequest { limit: 100 })
        .await?
        .into_inner()
        .items;
    assert!(!jobs.is_empty());
    let job = jobs[0].job.as_ref().unwrap().id.unwrap();
    assert!(client.job(job).await?.into_inner().value.is_some());
    assert!(client.delete_practice(practice).await?.into_inner().value);
    assert!(
        client
            .practice(practice)
            .await?
            .into_inner()
            .value
            .is_none()
    );
    assert!(
        client
            .delete_material(p::MaterialRequest {
                project: Some(project),
                kind: p::ArtifactKind::Flashcards as i32
            })
            .await?
            .into_inner()
            .value
    );
    assert!(
        client
            .artifact(artifact)
            .await?
            .into_inner()
            .value
            .is_none()
    );
    drop(client);
    server.shutdown().await.unwrap();
    let reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened
            .review_times(Some(study_core::ProjectId::new(project.value)), 0)
            .unwrap()
            .len(),
        0,
        "deleting material cascades review history"
    );
    assert!(
        reopened
            .document_of(study_core::SourceId::new(source.value))
            .unwrap()
            .unwrap()
            .1
            .meta
            .corrected
    );
    Ok(())
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn unix_socket_consumer_uses_same_generated_service() -> TestResult {
    let dir = tempfile::tempdir()?;
    let socket = dir.path().join("rpc.sock");
    let listener = tokio::net::UnixListener::bind(&socket)?;
    let service = Service::test(app(&dir.path().join("study.sqlite3")));
    let (stop, stopped) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(study_app::rpc::serve_unix(listener, service, async {
        let _ = stopped.await;
    }));
    let mut client = study_rpc::connect_unix(&socket).await?;
    client
        .create_project(p::CreateProjectRequest {
            name: "Unix socket".into(),
        })
        .await?;
    assert_eq!(
        client.projects(empty()).await?.into_inner().items[0].name,
        "Unix socket"
    );
    drop(client);
    let _ = stop.send(());
    task.await?.unwrap();
    Ok(())
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn independent_headless_process_requires_explicit_path_and_private_readiness() -> TestResult {
    use std::os::unix::fs::PermissionsExt;
    struct Process(std::process::Child);
    impl Drop for Process {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let dir = tempfile::tempdir()?;
    let db = dir.path().join("data/study.sqlite3");
    let ready = dir.path().join("ready.json");
    let mut child = Process(
        std::process::Command::new(env!("CARGO_BIN_EXE_study-service"))
            .args(["--test-mode", "--data-path"])
            .arg(&db)
            .arg("--ready-file")
            .arg(&ready)
            .args(["--listen", "127.0.0.1:0"])
            .stderr(std::process::Stdio::null())
            .spawn()?,
    );
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while !ready.exists() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "headless process stopped before readiness"
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await?;
    assert_eq!(
        std::fs::metadata(&ready)?.permissions().mode() & 0o777,
        0o600
    );
    let readiness: serde_json::Value = serde_json::from_slice(&std::fs::read(&ready)?)?;
    let address = readiness["address"].as_str().unwrap().parse()?;
    let token = readiness["token"].as_str().unwrap();
    let mut anonymous = study_rpc::connect_tcp(address).await?;
    assert_eq!(
        anonymous.get_health(empty()).await.unwrap_err().code(),
        Code::Unauthenticated
    );
    let channel = study_rpc::tonic::transport::Endpoint::from_shared(format!("http://{address}"))?
        .connect()
        .await?;
    let mut client =
        p::study_client::StudyClient::with_interceptor(channel, study_rpc::LocalToken::new(token)?);
    let health = client.get_health(empty()).await?.into_inner();
    assert!(health.test_mode);
    assert!(!health.workers_running);
    client
        .create_project(p::CreateProjectRequest {
            name: "Across processes".into(),
        })
        .await?;
    drop(client);
    drop(anonymous);
    let stopped = std::process::Command::new("kill")
        .args(["-TERM", &child.0.id().to_string()])
        .status()?;
    assert!(stopped.success());
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await?;
    assert!(!ready.exists());
    assert_eq!(app(&db).projects().unwrap()[0].name, "Across processes");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_ends_active_subscriptions_and_releases_listener() -> TestResult {
    let dir = tempfile::tempdir()?;
    let server = Embedded::start(app(&dir.path().join("study.sqlite3")), true)
        .await
        .unwrap();
    let address = server.address();
    let mut client = server.client().await?;
    let mut stream = client.subscribe(empty()).await?.into_inner();
    assert!(stream.message().await?.is_some());
    tokio::time::timeout(std::time::Duration::from_secs(3), server.shutdown())
        .await?
        .unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(1), stream.message())
            .await??
            .is_none()
    );
    // Rebinding is stronger evidence than an HTTP/2 client that may retain a stale channel.
    let rebound = tokio::net::TcpListener::bind(address).await?;
    drop(rebound);
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn exports_above_64_mib_keep_existing_source_size_support() -> TestResult {
    use std::io::{Seek, SeekFrom, Write};
    let dir = tempfile::tempdir()?;
    let input = dir.path().join("large.txt");
    let size = 64 * 1024 * 1024 + 4096;
    let mut file = std::fs::File::create(&input)?;
    file.set_len(size)?;
    file.write_all(b"start")?;
    file.seek(SeekFrom::End(-3))?;
    file.write_all(b"end")?;
    drop(file);
    let server = Embedded::start(app(&dir.path().join("study.sqlite3")), true)
        .await
        .unwrap();
    let mut client = server.client().await?;
    let source = client
        .import_file(p::ImportFileRequest {
            path: input.to_string_lossy().into(),
            project: None,
        })
        .await?
        .into_inner()
        .id
        .unwrap();
    let bytes = client.export_source(source).await?.into_inner().value;
    assert_eq!(bytes.len() as u64, size);
    assert_eq!(&bytes[..5], b"start");
    assert_eq!(&bytes[bytes.len() - 3..], b"end");
    drop(bytes);
    let destination = dir.path().join("large-export.txt");
    let written = client
        .export_source_to_file(p::ExportSourceToFileRequest {
            source_id: Some(source),
            destination: destination.to_string_lossy().into(),
        })
        .await?
        .into_inner()
        .value;
    assert_eq!(written, size);
    assert_eq!(std::fs::metadata(&destination)?.len(), size);
    drop(client);
    server.shutdown().await.unwrap();
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn account_credentials_stay_private_and_all_preference_scopes_are_typed() -> TestResult {
    use study_ai::chat::provider::chatgpt::{ChatGptAccount, ChatGptPreferences};
    let dir = tempfile::tempdir()?;
    let backend = app(&dir.path().join("study.sqlite3"));
    backend
        .save_preferences(&ChatGptPreferences {
            account: Some(ChatGptAccount {
                client_id: "private-registration".into(),
                subject: "account-subject".into(),
                email: Some("student@example.com".into()),
                sharing: true,
                refresh_token: study_core::preferences::Secret::parse(
                    "test-only-private-refresh-credential",
                ),
            }),
            ..ChatGptPreferences::default()
        })
        .unwrap();
    let server = Embedded::start(backend, true).await.unwrap();
    let mut client = server.client().await?;
    let account = client
        .connections(empty())
        .await?
        .into_inner()
        .chatgpt
        .unwrap();
    assert_eq!(account.subject, "account-subject");
    let public = serde_json::to_string(&account)?;
    assert!(!public.contains("private"));
    assert!(!public.contains("refresh"));
    assert!(!public.contains("client_id"));
    let mut llm = client.get_llm_settings(empty()).await?.into_inner();
    llm.tiny.as_mut().unwrap().model = Some(p::LlmModel::Gpt6Astra as i32);
    client.save_llm_settings(llm).await?;
    assert_eq!(
        client
            .get_llm_settings(empty())
            .await?
            .into_inner()
            .tiny
            .unwrap()
            .model,
        Some(p::LlmModel::Gpt6Astra as i32)
    );
    let llm = client.get_llm_settings(empty()).await?.into_inner();
    let err = client
        .save_llm_settings(p::LlmSettings {
            tiny: Some(p::TierSetup {
                provider: 999,
                model: None,
            }),
            ..llm
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&err), p::ErrorKind::InvalidInput);
    for error in [
        client.measure_machine(empty()).await.unwrap_err(),
        client.measure_machine_once(empty()).await.unwrap_err(),
        client
            .start_chatgpt_sign_in(p::StartSignInRequest { reconsent: false })
            .await
            .unwrap_err(),
        client.sign_out_chatgpt(empty()).await.unwrap_err(),
    ] {
        assert_eq!(kind(&error), p::ErrorKind::Config);
    }
    assert!(
        !client
            .get_health(empty())
            .await?
            .into_inner()
            .workers_running
    );
    drop(client);
    server.shutdown().await.unwrap();
    Ok(())
}
