//! One-time, hash-verified download of pinned model files.

use std::path::Path;
use std::time::Duration;

use futures::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use super::{ModelFile, ModelSpec};
use crate::{Error, Result};

/// Downloads every file of `spec` not yet in `dir`.
pub(super) async fn missing(spec: &ModelSpec, dir: &Path) -> Result<()> {
    // Serializes downloads within the process; the atomic rename protects across processes.
    static DOWNLOADS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = DOWNLOADS.lock().await;

    let missing = spec.missing_files(dir);
    if missing.is_empty() {
        return Ok(());
    }
    let client = client()?;
    for file in missing {
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            spec.repository, spec.revision, file.name
        );
        download_file(&client, &url, file, dir).await?;
    }
    Ok(())
}

/// The client for large downloads: connecting and each pause between reads are bounded, the
/// whole transfer is not.
fn client() -> reqwest::Result<reqwest::Client> {
    crate::http::client(crate::http::Timeouts {
        connect: Duration::from_secs(15),
        total: None,
        read: Some(Duration::from_secs(60)),
    })
}

/// Writes `url` to `dir/<file.name>` under a temporary name, and renames it into place only
/// once size and hash match.
async fn download_file(
    client: &reqwest::Client,
    url: &str,
    file: &ModelFile,
    dir: &Path,
) -> Result<()> {
    let destination = dir.join(file.name);
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // The process id keeps two running copies of Study from writing into one partial file.
    let partial = destination.with_file_name(format!(
        "{}.{}.part",
        destination
            .file_name()
            .unwrap_or_default()
            .to_string_lossy(),
        std::process::id()
    ));
    let result = async {
        let response = client.get(url).send().await?.error_for_status()?;
        let mut output = tokio::fs::File::create(&partial).await?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk?;
            hasher.update(&chunk);
            written += chunk.len() as u64;
            // A server sending more than the pinned size is wrong; stop before the disk fills.
            if written > file.size {
                return Err(Error::Model(format!(
                    "{} is larger than expected ({} bytes)",
                    file.name, file.size
                )));
            }
            output.write_all(&chunk).await?;
        }
        output.sync_all().await?;
        let digest = format!("{:x}", hasher.finalize());
        if written != file.size || digest != file.sha256 {
            return Err(Error::Model(format!(
                "{} failed verification ({written} bytes, sha256 {digest})",
                file.name
            )));
        }
        tokio::fs::rename(&partial, &destination).await?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::path;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const BODY: &[u8] = b"pinned model weights";

    fn pinned(size: u64, sha256: &'static str) -> ModelFile {
        ModelFile {
            name: "onnx/model.onnx",
            size,
            sha256,
        }
    }

    /// The SHA-256 of [`BODY`].
    const BODY_SHA256: &str = "48021633a2dcbb67c7fa2a3bc1bd8476c2bb864a37b54bdf00411f3183884998";

    async fn serving(body: &[u8]) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(path("/model"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
            .mount(&server)
            .await;
        server
    }

    /// Every file left in `dir`, relative to it.
    fn files_in(dir: &Path) -> Vec<String> {
        let mut found = Vec::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(next) = pending.pop() {
            for entry in std::fs::read_dir(next).unwrap() {
                let entry = entry.unwrap().path();
                if entry.is_dir() {
                    pending.push(entry);
                } else {
                    let relative = entry.strip_prefix(dir).unwrap();
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        found
    }

    #[tokio::test]
    async fn a_verified_file_lands_under_its_name() {
        let server = serving(BODY).await;
        let dir = tempfile::tempdir().unwrap();
        let file = pinned(BODY.len() as u64, BODY_SHA256);

        download_file(
            &client().unwrap(),
            &format!("{}/model", server.uri()),
            &file,
            dir.path(),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(dir.path().join(file.name)).unwrap(), BODY);
        assert_eq!(files_in(dir.path()), [file.name]);
    }

    #[tokio::test]
    async fn a_file_that_fails_verification_leaves_nothing_behind() {
        let server = serving(BODY).await;
        let dir = tempfile::tempdir().unwrap();
        let url = format!("{}/model", server.uri());
        let wrong_hash = pinned(BODY.len() as u64, "0000");
        let too_small = pinned(4, BODY_SHA256);
        let too_large = pinned(BODY.len() as u64 + 1, BODY_SHA256);

        for file in [wrong_hash, too_small, too_large] {
            let error = download_file(&client().unwrap(), &url, &file, dir.path())
                .await
                .unwrap_err();
            assert!(matches!(error, Error::Model(_)), "{error}");
            assert!(
                files_in(dir.path()).is_empty(),
                "{:?}",
                files_in(dir.path())
            );
        }
    }

    #[tokio::test]
    async fn a_server_error_is_a_network_error_of_its_status() {
        let server = MockServer::start().await;
        Mock::given(path("/model"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let dir = tempfile::tempdir().unwrap();
        let file = pinned(BODY.len() as u64, BODY_SHA256);

        let error = download_file(
            &client().unwrap(),
            &format!("{}/model", server.uri()),
            &file,
            dir.path(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, Error::Http(_)), "{error}");
        // Its status says the server is only busy, so the download is tried again.
        assert_eq!(
            study_core::Classify::kind(&error),
            study_core::ErrorKind::Transient
        );
        assert!(files_in(dir.path()).is_empty());
    }
}
