//! Owns the Node server process and its loopback transport.
use crate::transport::{Client, NativeError};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::Mutex,
};

pub struct Server {
    child: Mutex<Option<Child>>,
    pub client: Client,
}
impl Server {
    pub async fn start(
        node: PathBuf,
        entry: PathBuf,
        database: PathBuf,
    ) -> Result<Self, NativeError> {
        let (child, url) = spawn(&node, &entry, &database).await?;
        Ok(Self {
            child: Mutex::new(Some(child)),
            client: Client::new(url),
        })
    }
    pub async fn shutdown(&self) -> Result<(), NativeError> {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            drop(child.stdin.take());
            match tokio::time::timeout(Duration::from_secs(15), child.wait()).await {
                Ok(Ok(status)) if status.success() => (),
                Ok(Ok(status)) => {
                    return Err(NativeError::internal(format!("server exited: {status}")));
                }
                Ok(Err(e)) => return Err(NativeError::internal(e.to_string())),
                Err(_) => {
                    child
                        .kill()
                        .await
                        .map_err(|e| NativeError::internal(e.to_string()))?;
                    child
                        .wait()
                        .await
                        .map_err(|e| NativeError::internal(e.to_string()))?;
                    return Err(NativeError::internal("server shutdown timed out"));
                }
            }
        }
        Ok(())
    }
}
async fn spawn(
    node: &PathBuf,
    entry: &PathBuf,
    database: &PathBuf,
) -> Result<(Child, String), NativeError> {
    let mut child = Command::new(node)
        .arg(entry)
        .env("STUDY_DATABASE", database)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| NativeError::internal(format!("cannot launch server: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| NativeError::internal("server stdout unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();
    let ready = tokio::time::timeout(Duration::from_secs(30), lines.next_line())
        .await
        .map_err(|_| NativeError::internal("server readiness timed out"))?
        .map_err(|e| NativeError::internal(e.to_string()))?
        .ok_or_else(|| NativeError::internal("server exited before readiness"))?;
    let value: serde_json::Value = serde_json::from_str(&ready)
        .map_err(|_| NativeError::internal("invalid server readiness"))?;
    let url = value
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| NativeError::internal("missing server URL"))?;
    let parsed = url::Url::parse(url).map_err(|_| NativeError::internal("invalid server URL"))?;
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port().is_none()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(NativeError::internal("server URL must be loopback HTTP"));
    }
    let url = url.trim_end_matches('/').to_owned();
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!(%line, "unexpected server stdout");
        }
    });
    Ok((child, url))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[tokio::test]
    async fn process_starts_without_token_and_exits_after_stdin_closes() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("server.sh");
        std::fs::write(
            &script,
            "test -z \"${STUDY_SERVER_TOKEN+x}\" || exit 1\nprintf '{\"url\":\"http://127.0.0.1:4321\"}\\n'\ncat >/dev/null\n",
        )
        .unwrap();
        let server = Server::start("/bin/sh".into(), script, dir.path().join("db"))
            .await
            .unwrap();
        assert_eq!(server.client.url, "http://127.0.0.1:4321");
        server.shutdown().await.unwrap();
    }
    #[tokio::test]
    async fn process_rejects_non_loopback_readiness() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("server.sh");
        std::fs::write(&script, "printf '{\"url\":\"http://example.com:80\"}\\n'\n").unwrap();
        assert!(
            Server::start("/bin/sh".into(), script, dir.path().join("db"))
                .await
                .is_err()
        );
    }
}
