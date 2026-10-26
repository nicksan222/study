//! Real HTTP -> generated tonic client -> real tonic service -> SQLite consumer checks.
use reqwest::{Client, StatusCode};
use study_rpc::{prost::Message, v1 as p};
use study_web_bridge::{Capability, Config};

// The independent consumer targets only its private loopback fixture, not model/provider HTTP.
#[allow(clippy::disallowed_methods)]
fn http() -> Client {
    Client::new()
}

struct Harness {
    url: String,
    root: tempfile::TempDir,
    server: tokio::task::JoinHandle<()>,
    application: study_web_bridge::Application,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl Harness {
    async fn start() -> Self {
        let root = tempfile::tempdir().unwrap();
        let application = study_web_bridge::application(Config {
            fixture_root: root.path().to_owned(),
            data_path: None,
            origins: vec!["http://localhost:1423".into()],
        })
        .await
        .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let router = application.router.clone();
        let (stop, stopped) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
        });
        Self {
            url,
            root,
            server,
            application,
            stop: Some(stop),
        }
    }
    async fn session(&self) -> String {
        http()
            .post(format!("{}/__study/session", self.url))
            .json(&serde_json::json!({"seed":false}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json::<Capability>()
            .await
            .unwrap()
            .id
    }
    async fn rpc<I: Message, O: Message + Default>(
        &self,
        session: &str,
        method: &str,
        input: I,
    ) -> O {
        let response = http()
            .post(format!("{}/rpc/study.v1.Study/{method}", self.url))
            .header("x-study-session", session)
            .header("content-type", "application/protobuf")
            .body(input.encode_to_vec())
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
        O::decode(response.bytes().await.unwrap()).unwrap()
    }
}

#[tokio::test]
async fn isolated_sessions_crud_and_cleanup_through_real_generated_client() {
    let harness = Harness::start().await;
    let first = harness.session().await;
    let second = harness.session().await;
    let project: p::Project = harness
        .rpc(
            &first,
            "CreateProject",
            p::CreateProjectRequest {
                name: "Consumer isolation".into(),
            },
        )
        .await;
    assert_eq!(project.name, "Consumer isolation");
    let projects: p::Projects = harness.rpc(&first, "Projects", p::Empty {}).await;
    assert_eq!(projects.items.len(), 1);
    let projects: p::Projects = harness.rpc(&second, "Projects", p::Empty {}).await;
    assert!(projects.items.is_empty());
    let removed: p::BoolResult = harness
        .rpc(&first, "DeleteProject", project.id.unwrap())
        .await;
    assert!(removed.value);
    for id in [&first, &second] {
        assert_eq!(
            http()
                .delete(format!("{}/__study/session/{id}", harness.url))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
    }
    assert_eq!(std::fs::read_dir(harness.root.path()).unwrap().count(), 0);
    let stale = http()
        .post(format!("{}/rpc/study.v1.Study/Projects", harness.url))
        .header("x-study-session", first)
        .header("content-type", "application/protobuf")
        .body(Vec::new())
        .send()
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rejects_wrong_origins_malformed_bytes_and_unknown_methods() {
    let harness = Harness::start().await;
    let denied = http()
        .post(format!("{}/__study/session", harness.url))
        .header("origin", "https://unrelated.example")
        .json(&serde_json::json!({"seed":false}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let session = harness.session().await;
    for (method, bytes, expected) in [
        ("Missing", vec![], StatusCode::NOT_IMPLEMENTED),
        ("CreateProject", vec![0xff], StatusCode::BAD_REQUEST),
    ] {
        let response = http()
            .post(format!("{}/rpc/study.v1.Study/{method}", harness.url))
            .header("x-study-session", &session)
            .header("content-type", "application/protobuf")
            .body(bytes)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        let error: serde_json::Value = response.json().await.unwrap();
        assert!(error["code"].is_i64());
        assert!(error["message"].is_string());
    }
}

#[tokio::test]
async fn deleting_fixture_with_live_event_stream_is_bounded_and_revokes_access() {
    let harness = Harness::start().await;
    let session = harness.session().await;
    let mut events = http()
        .get(format!("{}/rpc/events", harness.url))
        .header("x-study-session", &session)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let first = tokio::time::timeout(std::time::Duration::from_secs(2), events.chunk())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&first).contains("event: study"));
    // Keep the active HTTP/SSE body alive: deletion must cancel the backend subscriber itself.
    let deleted = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        http()
            .delete(format!("{}/__study/session/{session}", harness.url))
            .send(),
    )
    .await
    .expect("fixture deletion cannot wait for SSE consumers")
    .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert_eq!(std::fs::read_dir(harness.root.path()).unwrap().count(), 0);
    let revoked = http()
        .get(format!("{}/rpc/events", harness.url))
        .header("x-study-session", &session)
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::NOT_FOUND);
    drop(events);
}

#[tokio::test]
async fn upload_is_session_scoped_and_import_uses_real_rpc() {
    let harness = Harness::start().await;
    let session = harness.session().await;
    let project: p::Project = harness
        .rpc(
            &session,
            "CreateProject",
            p::CreateProjectRequest {
                name: "Upload consumer".into(),
            },
        )
        .await;
    let file =
        reqwest::multipart::Part::bytes(b"A real text source.".to_vec()).file_name("lecture.txt");
    let upload: serde_json::Value = http()
        .post(format!("{}/rpc/__study/files", harness.url))
        .header("x-study-session", &session)
        .multipart(reqwest::multipart::Form::new().part("files", file))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let path = upload["paths"][0].as_str().unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"A real text source.");
    let imported: p::Source = harness
        .rpc(
            &session,
            "ImportFile",
            p::ImportFileRequest {
                path: path.to_owned(),
                project: project.id,
            },
        )
        .await;
    assert_eq!(imported.name, "lecture.txt");
    let exported: p::BytesResult = harness
        .rpc(&session, "ExportSource", imported.id.unwrap())
        .await;
    assert_eq!(exported.value, b"A real text source.");
    let deleted = http()
        .delete(format!("{}/__study/session/{session}", harness.url))
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!std::path::Path::new(path).exists());
}

impl Harness {
    async fn upload(&self, session: &str, name: &str, bytes: &[u8]) -> String {
        let result: serde_json::Value = http()
            .post(format!("{}/rpc/__study/files", self.url))
            .header("x-study-session", session)
            .multipart(reqwest::multipart::Form::new().part(
                "files",
                reqwest::multipart::Part::bytes(bytes.to_vec()).file_name(name.to_owned()),
            ))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        result["paths"][0].as_str().unwrap().to_owned()
    }
    async fn status_call<I: Message>(&self, session: &str, method: &str, input: I) -> StatusCode {
        http()
            .post(format!("{}/rpc/study.v1.Study/{method}", self.url))
            .header("x-study-session", session)
            .header("content-type", "application/protobuf")
            .body(input.encode_to_vec())
            .send()
            .await
            .unwrap()
            .status()
    }
}

#[tokio::test]
async fn path_rpcs_reject_cross_capability_and_outside_arena_reads_and_writes() {
    let h = Harness::start().await;
    let a = h.session().await;
    let b = h.session().await;
    let a_path = h.upload(&a, "a.txt", b"private A marker").await;
    let b_path = h.upload(&b, "b.txt", b"private B marker").await;
    let outside = tempfile::tempdir().unwrap();
    let outside_path = outside.path().join("untouched.txt");
    std::fs::write(&outside_path, b"outside marker").unwrap();
    for path in [&a_path, &outside_path.to_string_lossy().into_owned()] {
        assert_eq!(
            h.status_call(
                &b,
                "ImportFile",
                p::ImportFileRequest {
                    path: path.clone(),
                    project: None
                }
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            h.status_call(
                &b,
                "ImportFiles",
                p::ImportFilesRequest {
                    paths: vec![b_path.clone(), path.clone()],
                    project: None
                }
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            h.status_call(
                &b,
                "PostMessage",
                p::PostMessageRequest {
                    place: Some(p::post_message_request::Place::Timeline(p::SessionId {
                        value: 1
                    })),
                    text: String::new(),
                    files: vec![path.clone()]
                }
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            h.status_call(
                &b,
                "ExportSourceToFile",
                p::ExportSourceToFileRequest {
                    source_id: Some(p::SourceId { value: 1 }),
                    destination: path.clone()
                }
            )
            .await,
            StatusCode::FORBIDDEN
        );
    }
    let sources: p::Sources = h.rpc(&b, "Sources", p::Empty {}).await;
    assert!(
        sources.items.is_empty(),
        "reject whole batch before any real import"
    );
    assert_eq!(std::fs::read(a_path).unwrap(), b"private A marker");
    assert_eq!(std::fs::read(outside_path).unwrap(), b"outside marker");
}

#[cfg(unix)]
#[tokio::test]
async fn owned_upload_replaced_by_symlink_cannot_escape_the_arena() {
    let h = Harness::start().await;
    let session = h.session().await;
    let staged = h.upload(&session, "owned.txt", b"owned marker").await;
    let external = tempfile::tempdir().unwrap();
    let secret = external.path().join("secret.txt");
    std::fs::write(&secret, b"outside secret").unwrap();
    std::fs::remove_file(&staged).unwrap();
    std::os::unix::fs::symlink(&secret, &staged).unwrap();
    assert_eq!(
        h.status_call(
            &session,
            "ImportFile",
            p::ImportFileRequest {
                path: staged,
                project: None
            }
        )
        .await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(std::fs::read(secret).unwrap(), b"outside secret");
    let staged = h
        .upload(&session, "parent-alias.txt", b"owned parent marker")
        .await;
    let parent = std::path::Path::new(&staged)
        .parent()
        .unwrap()
        .to_path_buf();
    let moved = external.path().join("moved-owned-folder");
    std::fs::rename(&parent, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &parent).unwrap();
    assert_eq!(
        h.status_call(
            &session,
            "ImportFile",
            p::ImportFileRequest {
                path: staged,
                project: None
            }
        )
        .await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        std::fs::read(moved.join("parent-alias.txt")).unwrap(),
        b"owned parent marker"
    );
}

#[tokio::test]
async fn rejected_upload_batches_roll_back_and_release_enforces_ownership_and_quota() {
    let h = Harness::start().await;
    let a = h.session().await;
    let b = h.session().await;
    let initial = h.upload(&a, "first.txt", b"first").await;
    let arena = std::path::Path::new(&initial)
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let count = || std::fs::read_dir(arena).unwrap().count();
    assert_eq!(count(), 1);
    for _ in 0..3 {
        let rejected = http()
            .post(format!("{}/rpc/__study/files", h.url))
            .header("x-study-session", &a)
            .multipart(
                reqwest::multipart::Form::new()
                    .part(
                        "files",
                        reqwest::multipart::Part::bytes(b"rollback".to_vec())
                            .file_name("valid.txt"),
                    )
                    .text("unexpected", "bad"),
            )
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            count(),
            1,
            "late invalid part must roll back earlier staged files"
        );
    }
    let foreign = h.upload(&b, "foreign.txt", b"foreign").await;
    let release = http()
        .delete(format!("{}/rpc/__study/files", h.url))
        .header("x-study-session", &a)
        .json(&serde_json::json!({"paths":[foreign, initial]}))
        .send()
        .await
        .unwrap();
    assert_eq!(release.status(), StatusCode::NO_CONTENT);
    assert!(!std::path::Path::new(&initial).exists());
    assert!(
        std::path::Path::new(&foreign).exists(),
        "unowned paths are ignored"
    );
    for batch in 0..4 {
        let mut form = reqwest::multipart::Form::new();
        for file in 0..32 {
            form = form.part(
                "files",
                reqwest::multipart::Part::bytes(vec![1]).file_name(format!("{batch}-{file}.txt")),
            );
        }
        assert!(
            http()
                .post(format!("{}/rpc/__study/files", h.url))
                .header("x-study-session", &a)
                .multipart(form)
                .send()
                .await
                .unwrap()
                .status()
                .is_success()
        );
    }
    assert_eq!(count(), 128);
    let quota = http()
        .post(format!("{}/rpc/__study/files", h.url))
        .header("x-study-session", &a)
        .multipart(reqwest::multipart::Form::new().part(
            "files",
            reqwest::multipart::Part::bytes(vec![1]).file_name("overflow.txt"),
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(quota.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(count(), 128);
}

struct UnfinishedUpload {
    socket: tokio::net::TcpStream,
    suffix: Vec<u8>,
    arena: std::path::PathBuf,
}
impl UnfinishedUpload {
    async fn start(harness: &Harness, session: &str) -> Self {
        Self::start_at(harness, session, false).await
    }
    async fn start_at(harness: &Harness, session: &str, unfinished_headers: bool) -> Self {
        use tokio::io::AsyncWriteExt;
        let initial = harness.upload(session, "committed.txt", b"committed").await;
        let arena = std::path::Path::new(&initial)
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let address = harness.url.strip_prefix("http://").unwrap();
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        let boundary = "study-lifecycle-regression";
        let first = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"uncommitted.txt\"\r\n\r\nrollback marker\r\n--{boundary}\r\n"
        );
        let (prefix, suffix) = if unfinished_headers {
            (
                format!("{first}Content-Disposition: form-data; name=\"files\""),
                format!("; filename=\"unfinished.txt\"\r\n\r\nlate body\r\n--{boundary}--\r\n")
                    .into_bytes(),
            )
        } else {
            (
                format!(
                    "{first}Content-Disposition: form-data; name=\"files\"; filename=\"unfinished.txt\"\r\n\r\nstill uploading"
                ),
                format!(" remainder\r\n--{boundary}--\r\n").into_bytes(),
            )
        };
        let headers = format!(
            "POST /rpc/__study/files HTTP/1.1\r\nHost: {address}\r\nx-study-session: {session}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\n"
        );
        let (headers, prefix, suffix) = if unfinished_headers {
            // Exercise chunked framing too: a complete first chunk contains an incomplete
            // second part header, and no terminating body bytes/chunk have arrived.
            let framed_prefix = format!("{:x}\r\n{prefix}\r\n", prefix.len()).into_bytes();
            let framed_suffix = [
                format!("{:x}\r\n", suffix.len()).into_bytes(),
                suffix,
                b"\r\n0\r\n\r\n".to_vec(),
            ]
            .concat();
            (
                format!("{headers}Transfer-Encoding: chunked\r\n\r\n"),
                framed_prefix,
                framed_suffix,
            )
        } else {
            (
                format!(
                    "{headers}Content-Length: {}\r\n\r\n",
                    prefix.len() + suffix.len()
                ),
                prefix.into_bytes(),
                suffix,
            )
        };
        socket.write_all(headers.as_bytes()).await.unwrap();
        socket.write_all(&prefix).await.unwrap();
        // Real first-part staging is the synchronization barrier; the second part stays open.
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while std::fs::read_dir(&arena).unwrap().count() != 2 {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("first upload part must stage before teardown");
        let mut response = [0_u8; 1];
        assert_eq!(
            socket.try_read(&mut response).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock,
            "upload must still be waiting for body bytes"
        );
        Self {
            socket,
            suffix,
            arena,
        }
    }
    async fn finish_after_teardown(mut self) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        // Do not assist teardown with EOF. Only send the missing bytes AFTER cleanup returned.
        let _ = self.socket.write_all(&self.suffix).await;
        let header = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut bytes = Vec::new();
            while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                let mut piece = [0; 1024];
                match self.socket.read(&mut piece).await {
                    Ok(0) | Err(_) => break,
                    Ok(count) => bytes.extend_from_slice(&piece[..count]),
                }
            }
            String::from_utf8_lossy(&bytes).into_owned()
        })
        .await
        .expect("cancelled upload must return or close its response");
        assert!(
            header.is_empty() || header.starts_with("HTTP/1.1 410"),
            "cancelled upload cannot succeed later: {header}"
        );
        assert!(
            !self.arena.exists(),
            "late bytes must not recreate or commit the arena"
        );
    }
}

#[tokio::test]
async fn deleting_fixture_cancels_stalled_upload_without_client_eof() {
    let h = Harness::start().await;
    let session = h.session().await;
    let upload = UnfinishedUpload::start(&h, &session).await;
    let deleted = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        http()
            .delete(format!("{}/__study/session/{session}", h.url))
            .send(),
    )
    .await
    .expect("delete must cancel its body reader, not wait for client EOF")
    .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!upload.arena.exists());
    assert_eq!(
        std::fs::read_dir(h.root.path()).unwrap().count(),
        0,
        "database must close and disappear too"
    );
    upload.finish_after_teardown().await;
    assert_eq!(
        h.status_call(&session, "Sources", p::Empty {}).await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn application_shutdown_cancels_all_stalled_uploads_and_stops_admission() {
    let mut h = Harness::start().await;
    let first = h.session().await;
    let second = h.session().await;
    let a = UnfinishedUpload::start(&h, &first).await;
    let b = UnfinishedUpload::start_at(&h, &second, true).await;
    tokio::time::timeout(std::time::Duration::from_secs(2), h.application.shutdown())
        .await
        .expect("application shutdown must own HTTP upload cancellation")
        .unwrap();
    assert!(!a.arena.exists());
    assert!(!b.arena.exists());
    assert_eq!(std::fs::read_dir(h.root.path()).unwrap().count(), 0);
    let rejected = http()
        .post(format!("{}/__study/session", h.url))
        .json(&serde_json::json!({"seed":false}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        rejected.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "shutdown fences new allocations"
    );
    // Mirror the actual bridge sequence: finish Application shutdown, signal Axum, await it.
    h.stop.take().unwrap().send(()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), &mut h.server)
        .await
        .expect("HTTP graceful shutdown cannot await stalled body EOF")
        .unwrap();
    a.finish_after_teardown().await;
    b.finish_after_teardown().await;
}

#[tokio::test]
async fn deleting_fixture_cancels_unary_and_json_extractors_before_body_eof() {
    use tokio::io::AsyncWriteExt;
    let h = Harness::start().await;
    let session = h.session().await;
    let original = h
        .upload(&session, "owned.txt", b"retained until teardown")
        .await;
    let arena = std::path::Path::new(&original)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let unary = p::CreateProjectRequest {
        name: "must not be created from abandoned body".into(),
    }
    .encode_to_vec();
    let json = serde_json::to_vec(&serde_json::json!({"paths":[original]})).unwrap();
    let mut waiting = Vec::new();
    for (method, path, mime, bytes) in [
        (
            "POST",
            "/rpc/study.v1.Study/CreateProject",
            "application/protobuf",
            unary,
        ),
        ("DELETE", "/rpc/__study/files", "application/json", json),
    ] {
        let address = h.url.strip_prefix("http://").unwrap();
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        let headers = format!(
            "{method} {path} HTTP/1.1\r\nHost: {address}\r\nx-study-session: {session}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\n\r\n",
            bytes.len()
        );
        socket.write_all(headers.as_bytes()).await.unwrap();
        socket.write_all(&bytes[..bytes.len() - 1]).await.unwrap();
        waiting.push(UnfinishedUpload {
            socket,
            suffix: bytes[bytes.len() - 1..].to_vec(),
            arena: arena.clone(),
        });
    }
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let deleted = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        http()
            .delete(format!("{}/__study/session/{session}", h.url))
            .send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!arena.exists());
    assert_eq!(std::fs::read_dir(h.root.path()).unwrap().count(), 0);
    for request in waiting {
        request.finish_after_teardown().await;
    }
    assert_eq!(
        h.status_call(&session, "Projects", p::Empty {}).await,
        StatusCode::NOT_FOUND
    );
}
