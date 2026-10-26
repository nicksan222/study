//! Actual CLI SIGTERM must close every HTTP framing phase without client-assisted EOF.
#![cfg(unix)]
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

#[allow(clippy::disallowed_methods)]
fn http() -> reqwest::Client {
    reqwest::Client::new()
}

struct BridgeProcess {
    child: Child,
    url: String,
    _work: tempfile::TempDir,
    temporary: PathBuf,
}
impl Drop for BridgeProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}
impl BridgeProcess {
    async fn start() -> Self {
        let work = tempfile::tempdir().unwrap();
        let temporary = work.path().join("private-temp");
        std::fs::create_dir(&temporary).unwrap();
        let log = std::fs::File::create(work.path().join("bridge.log")).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let child = Command::new(env!("CARGO_BIN_EXE_study-web-bridge"))
            .args(["--fixture-only", "--port", &address.port().to_string()])
            .env("TMPDIR", &temporary)
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .spawn()
            .unwrap();
        let mut owned = Self {
            child,
            url: format!("http://{address}"),
            _work: work,
            temporary,
        };
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                assert!(
                    owned.child.try_wait().unwrap().is_none(),
                    "private bridge exited before ready"
                );
                if http()
                    .get(format!("{}/__study/health", owned.url))
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success())
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("private bridge readiness");
        owned
    }
    async fn fixture(&self) -> String {
        let value: serde_json::Value = http()
            .post(format!("{}/__study/session", self.url))
            .json(&serde_json::json!({"seed":false}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        value["id"].as_str().unwrap().to_owned()
    }
    async fn incomplete(
        &self,
        path: &str,
        method: &str,
        content_type: &str,
        session: Option<&str>,
        fragment: &[u8],
    ) -> TcpStream {
        let address = self.url.strip_prefix("http://").unwrap();
        let mut stream = TcpStream::connect(address).await.unwrap();
        let capability = session
            .map(|id| format!("x-study-session: {id}\r\n"))
            .unwrap_or_default();
        let header = format!(
            "{method} {path} HTTP/1.1\r\nHost: {address}\r\n{capability}Content-Type: {content_type}\r\nContent-Length: 1000\r\n\r\n"
        );
        stream.write_all(header.as_bytes()).await.unwrap();
        stream.write_all(fragment).await.unwrap();
        stream
    }
    async fn terminate_before_eof(&mut self) {
        assert!(
            Command::new("kill")
                .args(["-TERM", &self.child.id().to_string()])
                .status()
                .unwrap()
                .success()
        );
        let exit = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(status) = self.child.try_wait().unwrap() {
                    break status;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("SIGTERM must exit before any client supplies body/header EOF");
        assert!(
            exit.success(),
            "bridge must finish graceful cleanup, not be killed"
        );
        let log = std::fs::read_to_string(self._work.path().join("bridge.log")).unwrap();
        assert!(
            !log.contains("panicked"),
            "connection cleanup must not panic: {log}"
        );
        assert_eq!(
            std::fs::read_dir(&self.temporary).unwrap().count(),
            0,
            "all DB/staging arenas must be removed before exit"
        );
    }
}

#[tokio::test]
async fn sigterm_closes_incomplete_unary_json_and_connection_headers_before_client_eof() {
    let mut bridge = BridgeProcess::start().await;
    let session = bridge.fixture().await;
    let unary = bridge
        .incomplete(
            "/rpc/study.v1.Study/Projects",
            "POST",
            "application/protobuf",
            Some(&session),
            b"\0",
        )
        .await;
    let create = bridge
        .incomplete(
            "/__study/session",
            "POST",
            "application/json",
            None,
            b"{\"seed\":",
        )
        .await;
    let release = bridge
        .incomplete(
            "/rpc/__study/files",
            "DELETE",
            "application/json",
            Some(&session),
            b"{\"paths\":[",
        )
        .await;
    let address = bridge.url.strip_prefix("http://").unwrap();
    let mut headers = TcpStream::connect(address).await.unwrap();
    headers
        .write_all(b"POST /__study/session HTTP/1.1\r\nHost: localhost\r\n")
        .await
        .unwrap();
    let idle = TcpStream::connect(address).await.unwrap();
    // Give the actual child server a scheduling turn; none of these clients provide EOF.
    tokio::time::sleep(Duration::from_millis(50)).await;
    bridge.terminate_before_eof().await;
    for mut connection in [unary, create, release, headers, idle] {
        let mut reply = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(1), connection.read_to_end(&mut reply))
            .await
            .unwrap();
        assert!(
            !String::from_utf8_lossy(&reply).contains("200 OK"),
            "abandoned input cannot succeed after shutdown"
        );
    }
}
