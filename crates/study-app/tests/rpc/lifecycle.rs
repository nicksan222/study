//! Adversarial consumer tests keep HTTP/2 request bodies and auth callbacks unfinished.
use bytes::Bytes;
use prost::Message;
use std::time::Duration;
use study_app::{App, rpc::Embedded};
use study_rpc::{tonic::Code, v1 as p};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
type TestResult = Result<(), Box<dyn std::error::Error>>;

struct Unfinished {
    send: h2::SendStream<Bytes>,
    response: h2::client::ResponseFuture,
    connection: tokio::task::JoinHandle<()>,
}
impl Drop for Unfinished {
    fn drop(&mut self) {
        self.connection.abort();
    }
}
impl Unfinished {
    async fn project(address: std::net::SocketAddr, token: &str) -> Self {
        Self::request(
            address,
            token,
            "CreateProject",
            p::CreateProjectRequest {
                name: "Late project".into(),
            }
            .encode_to_vec(),
        )
        .await
    }
    async fn request(
        address: std::net::SocketAddr,
        token: &str,
        method: &str,
        payload: Vec<u8>,
    ) -> Self {
        let socket = tokio::net::TcpStream::connect(address).await.unwrap();
        let (mut sender, connection) = h2::client::handshake(socket).await.unwrap();
        let connection = tokio::spawn(async {
            let _ = connection.await;
        });
        let request = http::Request::builder()
            .method("POST")
            .uri(format!("http://{address}/study.v1.Study/{method}"))
            .header("content-type", "application/grpc")
            .header("te", "trailers")
            .header("x-study-token", token)
            .body(())
            .unwrap();
        let (response, mut send) = sender.send_request(request, false).unwrap();
        let mut framed = vec![0];
        framed.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        framed.extend_from_slice(&payload);
        send.send_data(Bytes::from(framed), false).unwrap();
        // Give the connection driver a turn to flush the complete frame. The body
        // deliberately stays incomplete: no HTTP/2 END_STREAM is ever sent before stop.
        tokio::time::sleep(Duration::from_millis(30)).await;
        Self {
            send,
            response,
            connection,
        }
    }
    async fn release(&mut self) {
        if self.send.send_data(Bytes::new(), true).is_ok()
            && let Ok(Ok(response)) =
                tokio::time::timeout(Duration::from_secs(1), &mut self.response).await
        {
            let mut body = response.into_body();
            while let Some(data) = body.data().await {
                let _ = data;
            }
        }
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn stopped_transport_cannot_commit_a_late_unary_body() -> TestResult {
    let dir = tempfile::tempdir()?;
    let app = App::open(dir.path().join("study.sqlite3")).unwrap();
    let server = Embedded::start(app.clone(), true).await.unwrap();
    let mut pending = Unfinished::project(server.address(), server.token()).await;
    assert!(app.projects().unwrap().is_empty());
    tokio::time::timeout(Duration::from_secs(3), server.shutdown())
        .await?
        .unwrap();
    pending.release().await;
    assert!(
        app.projects().unwrap().is_empty(),
        "unfinished accepted request committed after shutdown"
    );
    Ok(())
}

async fn callback(attempt: &p::SignInAttempt, decline: bool) -> std::io::Result<()> {
    let url = url::Url::parse(&attempt.url).unwrap();
    let redirect = url
        .query_pairs()
        .find(|(key, _)| key == "redirect_uri")
        .unwrap()
        .1
        .into_owned();
    let redirect = url::Url::parse(&redirect).unwrap();
    let path = if decline {
        let state = url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        format!("{}?state={state}&error=access_denied", redirect.path())
    } else {
        "/prove-callback-is-running".into()
    };
    let mut socket =
        tokio::net::TcpStream::connect(("127.0.0.1", redirect.port().unwrap())).await?;
    socket
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await?;
    let mut response = Vec::new();
    socket.read_to_end(&mut response).await?;
    assert!(response.starts_with(if decline {
        b"HTTP/1.1 200"
    } else {
        b"HTTP/1.1 404"
    }));
    Ok(())
}
async fn callback_is_closed(attempt: &p::SignInAttempt) {
    let url = url::Url::parse(&attempt.url).unwrap();
    let redirect = url
        .query_pairs()
        .find(|(key, _)| key == "redirect_uri")
        .unwrap()
        .1
        .into_owned();
    let url = url::Url::parse(&redirect).unwrap();
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", url.port().unwrap()))
            .await
            .is_err(),
        "cancelled callback listener is still open"
    );
}
type Finish = tokio::task::JoinHandle<
    Result<study_rpc::tonic::Response<p::ChatGptAccount>, study_rpc::tonic::Status>,
>;

/// A callback response proves only that Start's callback task is listening. Two Finish
/// calls race for one receiver: the typed duplicate error proves the other call has
/// claimed that receiver and is an admitted application operation. Keep that active call.
async fn active_finish(
    client: &study_rpc::LocalClient,
    attempt: &p::SignInAttempt,
) -> Result<Finish, Box<dyn std::error::Error>> {
    let spawn = || {
        let mut client = client.clone();
        let id = attempt.attempt_id.clone();
        tokio::spawn(async move {
            client
                .finish_chatgpt_sign_in(p::FinishSignInRequest { attempt_id: id })
                .await
        })
    };
    let mut first = spawn();
    let mut second = spawn();
    let (duplicate, active) = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::select! {
            duplicate=&mut first=>(duplicate,second),
            duplicate=&mut second=>(duplicate,first),
        }
    })
    .await?;
    let duplicate = duplicate?.unwrap_err();
    assert_eq!(duplicate.code(), Code::FailedPrecondition);
    assert_eq!(
        study_rpc::error_details(&duplicate)
            .expect("duplicate Finish has classified details")
            .kind(),
        p::ErrorKind::Config
    );
    Ok(active)
}

#[tokio::test(flavor = "multi_thread")]
async fn cancelling_or_replacing_an_active_finish_closes_its_callback() -> TestResult {
    let dir = tempfile::tempdir()?;
    let app = App::open(dir.path().join("study.sqlite3")).unwrap();
    // Production auth implementation, local callback only: no workers, real auth or network.
    let server = Embedded::start(app.clone(), false).await.unwrap();
    let mut client = server.client().await?;
    for replace in [false, true] {
        let old = client
            .start_chatgpt_sign_in(p::StartSignInRequest { reconsent: false })
            .await?
            .into_inner();
        let finish = active_finish(&client, &old).await?;
        tokio::time::timeout(Duration::from_secs(1), callback(&old, false)).await??;
        let new = if replace {
            Some(
                client
                    .start_chatgpt_sign_in(p::StartSignInRequest { reconsent: false })
                    .await?
                    .into_inner(),
            )
        } else {
            assert!(
                client
                    .cancel_chatgpt_sign_in(p::FinishSignInRequest {
                        attempt_id: old.attempt_id.clone()
                    })
                    .await?
                    .into_inner()
                    .value
            );
            None
        };
        let cancelled = tokio::time::timeout(Duration::from_secs(1), finish)
            .await??
            .unwrap_err();
        assert_eq!(cancelled.code(), Code::Cancelled);
        assert_eq!(
            study_rpc::error_details(&cancelled).unwrap().kind(),
            p::ErrorKind::Cancelled
        );
        callback_is_closed(&old).await;
        if let Some(new) = new {
            let mut finishing_client = client.clone();
            let id = new.attempt_id.clone();
            let finish = tokio::spawn(async move {
                finishing_client
                    .finish_chatgpt_sign_in(p::FinishSignInRequest { attempt_id: id })
                    .await
            });
            tokio::time::timeout(Duration::from_secs(1), callback(&new, true)).await??;
            assert_eq!(finish.await?.unwrap_err().code(), Code::Cancelled);
        }
        assert!(app.connections().unwrap().chatgpt.is_none());
    }
    drop(client);
    server.shutdown().await.unwrap();
    Ok(())
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn headless_sigterm_closes_an_unfinished_unary_without_waiting_for_client() -> TestResult {
    struct Process(std::process::Child);
    impl Drop for Process {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let dir = tempfile::tempdir()?;
    let database = dir.path().join("study.sqlite3");
    let ready = dir.path().join("ready.json");
    let mut process = Process(
        std::process::Command::new(env!("CARGO_BIN_EXE_study-service"))
            .args(["--test-mode", "--data-path"])
            .arg(&database)
            .arg("--ready-file")
            .arg(&ready)
            .stderr(std::process::Stdio::null())
            .spawn()?,
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        while !ready.exists() {
            assert!(process.0.try_wait().unwrap().is_none());
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    let info: serde_json::Value = serde_json::from_slice(&std::fs::read(&ready)?)?;
    let mut request = Unfinished::project(
        info["address"].as_str().unwrap().parse()?,
        info["token"].as_str().unwrap(),
    )
    .await;
    assert!(
        std::process::Command::new("kill")
            .args(["-TERM", &process.0.id().to_string()])
            .status()?
            .success()
    );
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Some(status) = process.0.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    request.release().await;
    assert!(!ready.exists());
    assert!(App::open(database).unwrap().projects().unwrap().is_empty());
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_cancels_an_active_auth_finish_and_its_local_listener() -> TestResult {
    let dir = tempfile::tempdir()?;
    let app = App::open(dir.path().join("study.sqlite3")).unwrap();
    let server = Embedded::start(app.clone(), false).await.unwrap();
    let mut client = server.client().await?;
    let attempt = client
        .start_chatgpt_sign_in(p::StartSignInRequest { reconsent: false })
        .await?
        .into_inner();
    let finish = active_finish(&client, &attempt).await?;
    tokio::time::timeout(Duration::from_secs(1), callback(&attempt, false)).await??;
    tokio::time::timeout(Duration::from_secs(3), server.shutdown())
        .await?
        .unwrap();
    let error = finish.await?.unwrap_err();
    assert_eq!(error.code(), Code::Cancelled);
    assert_eq!(
        study_rpc::error_details(&error)
            .unwrap_or_else(|| panic!(
                "admitted Finish lost its classified cancellation: {error:?}"
            ))
            .kind(),
        p::ErrorKind::Cancelled
    );
    callback_is_closed(&attempt).await;
    assert!(app.connections().unwrap().chatgpt.is_none());
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_before_finish_admission_closes_the_callback_without_saving_an_account()
-> TestResult {
    let dir = tempfile::tempdir()?;
    let app = App::open(dir.path().join("study.sqlite3")).unwrap();
    let server = Embedded::start(app.clone(), false).await.unwrap();
    let mut client = server.client().await?;
    let attempt = client
        .start_chatgpt_sign_in(p::StartSignInRequest { reconsent: false })
        .await?
        .into_inner();
    // The callback is live, but this complete gRPC message deliberately has no END_STREAM:
    // the unary decoder cannot admit Finish even though the callback responds successfully.
    tokio::time::timeout(Duration::from_secs(1), callback(&attempt, false)).await??;
    let mut pending = Unfinished::request(
        server.address(),
        server.token(),
        "FinishChatgptSignIn",
        p::FinishSignInRequest {
            attempt_id: attempt.attempt_id.clone(),
        }
        .encode_to_vec(),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(3), server.shutdown())
        .await?
        .unwrap();
    let response = tokio::time::timeout(Duration::from_secs(1), &mut pending.response).await?;
    assert!(
        response.is_err(),
        "unfinished Finish was answered as an application RPC"
    );
    let _ = pending.send.send_data(Bytes::new(), true);
    callback_is_closed(&attempt).await;
    assert!(app.connections().unwrap().chatgpt.is_none());
    Ok(())
}
