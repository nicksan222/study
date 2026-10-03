//! Signed desktop updates from GitHub Releases. Checking is explicit; installation verifies
//! the downloaded package before replacing the application, never its database or models.
//! cargo-packager owns signature verification and platform installation. Manifest requests
//! use our async HTTP client: the upstream blocking checker mutates process environment.

use crate::{
    Error, Result,
    blocking::blocking,
    http::{self, Timeouts},
};
use cargo_packager_updater::{Config, RemoteRelease, Update, UpdateFormat};
use std::{path::PathBuf, time::Duration};
use study_core::{Classify, ErrorKind};

const ENDPOINT: Option<&str> = option_env!("STUDY_UPDATE_ENDPOINT");
/// Version shared by the update comparison and Settings.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

const PUBLIC_KEY: Option<&str> = option_env!("STUDY_UPDATE_PUBLIC_KEY");

/// Development builds have no signing key and cannot replace themselves.
pub fn configured() -> bool {
    ENDPOINT.is_some_and(|endpoint| !endpoint.is_empty())
        && PUBLIC_KEY.is_some_and(|key| !key.trim().is_empty())
        && (!cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some())
}

/// An available package, including the trusted key compiled into this application.
#[derive(Clone, Debug)]
pub struct AvailableUpdate {
    /// Version displayed before the user approves installation.
    pub version: String,
    package: Update,
}

impl AvailableUpdate {
    /// Download, verify, then install. Windows' installer exits the running application.
    pub async fn install(&self) -> Result<()> {
        let package = self.package.clone();
        blocking("updater", move || {
            package.download_and_install().map_err(Error::from)
        })
        .await
    }
}

/// Check the latest release without downloading or installing a package.
pub async fn check() -> Result<Option<AvailableUpdate>> {
    if !configured() {
        return Err(cargo_packager_updater::Error::UnsupportedUpdateFormat.into());
    }
    check_at(
        ENDPOINT.unwrap_or_default(),
        PUBLIC_KEY.unwrap_or_default(),
        VERSION,
        executable()?,
    )
    .await
}

fn executable() -> Result<PathBuf> {
    if cfg!(target_os = "linux")
        && let Some(path) = std::env::var_os("APPIMAGE")
    {
        return Ok(path.into());
    }
    Ok(cargo_packager_utils::current_exe::current_exe()?)
}

/// Replace the running process on Unix so old and new job engines never overlap.
/// Windows installation already exits and restarts through the installer.
pub fn restart() -> Result<()> {
    let mut command = std::process::Command::new(executable()?);
    // AppImage runtime variables describe the old mounted image, not the new process.
    command
        .env_remove("APPIMAGE")
        .env_remove("APPDIR")
        .env_remove("OWD");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        Err(command.exec().into())
    }
    #[cfg(not(unix))]
    {
        command.spawn()?;
        Ok(())
    }
}

async fn check_at(
    endpoint: &str,
    key: &str,
    current: &str,
    executable: PathBuf,
) -> Result<Option<AvailableUpdate>> {
    let response = http::client(Timeouts::api(Duration::from_secs(30)))?
        .get(endpoint)
        .send()
        .await?
        .error_for_status()?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    let release: RemoteRelease = response.json().await?;
    let current = semver::Version::parse(current).map_err(cargo_packager_updater::Error::from)?;
    if release.version <= current {
        return Ok(None);
    }
    let target =
        cargo_packager_updater::target().ok_or(cargo_packager_updater::Error::UnsupportedOs)?;
    let format = release.format(&target)?;
    let expected = if cfg!(target_os = "linux") {
        UpdateFormat::AppImage
    } else if cfg!(target_os = "macos") {
        UpdateFormat::App
    } else {
        UpdateFormat::Nsis
    };
    if std::mem::discriminant(&format) != std::mem::discriminant(&expected) {
        return Err(cargo_packager_updater::Error::UnsupportedUpdateFormat.into());
    }
    let extract_path = if cfg!(target_os = "macos") {
        executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|ext| ext == "app"))
            .ok_or(cargo_packager_updater::Error::FailedToDetermineExtractPath)?
            .to_path_buf()
    } else if cfg!(target_os = "windows") {
        executable
            .parent()
            .ok_or(cargo_packager_updater::Error::FailedToDetermineExtractPath)?
            .to_path_buf()
    } else {
        executable
    };
    let package = Update {
        config: Config {
            endpoints: vec![],
            pubkey: key.into(),
            ..Default::default()
        },
        body: release.notes.clone(),
        current_version: current.to_string(),
        version: release.version.to_string(),
        date: release.pub_date,
        target: target.clone(),
        extract_path,
        download_url: release.download_url(&target)?.clone(),
        signature: release.signature(&target)?.clone(),
        timeout: Some(Duration::from_secs(1200)),
        headers: Default::default(),
        format,
    };
    Ok(Some(AvailableUpdate {
        version: package.version.clone(),
        package,
    }))
}

pub(crate) fn error_kind(error: &cargo_packager_updater::Error) -> ErrorKind {
    use cargo_packager_updater::Error as E;
    match error {
        E::Io(error) => Classify::kind(error),
        E::Reqwest(error) => error.status().map_or(ErrorKind::Transient, |status| {
            crate::error::kind_of_status(status.as_u16())
        }),
        E::Network(_) => ErrorKind::Transient,
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::Serialization(_) => {
            ErrorKind::InvalidInput
        }
        E::UnsupportedArch | E::UnsupportedOs | E::UnsupportedUpdateFormat => {
            ErrorKind::Unsupported
        }
        E::EmptyEndpoints | E::TargetNotFound(_) | E::ReleaseNotFound => ErrorKind::Config,
        _ => ErrorKind::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::path};

    async fn release(version: &str, corrupt: bool) -> (MockServer, String) {
        let server = MockServer::start().await;
        let keys = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let bytes = b"new signed application";
        let signature =
            minisign::sign(None, &keys.sk, std::io::Cursor::new(bytes), None, None).unwrap();
        let target = cargo_packager_updater::target().unwrap();
        let format = if cfg!(target_os = "macos") {
            "app"
        } else if cfg!(windows) {
            "nsis"
        } else {
            "appimage"
        };
        Mock::given(path("/latest.json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "version": version,
                "platforms": { target: { "url": format!("{}/package", server.uri()),
                    "signature": STANDARD.encode(signature.to_string()), "format": format } }
            })))
            .mount(&server)
            .await;
        Mock::given(path("/package"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(if corrupt {
                b"tampered application".to_vec()
            } else {
                bytes.to_vec()
            }))
            .mount(&server)
            .await;
        (
            server,
            STANDARD.encode(keys.pk.to_box().unwrap().to_string()),
        )
    }

    fn fake_executable(root: &std::path::Path) -> PathBuf {
        let path = if cfg!(target_os = "macos") {
            root.join("Study.app/Contents/MacOS/study")
        } else {
            root.join("Study.AppImage")
        };
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"old application").unwrap();
        path
    }

    #[tokio::test]
    async fn updates_verify_real_signed_http_download() {
        let (server, key) = release("1.2.0", false).await;
        let root = tempfile::tempdir().unwrap();
        let update = check_at(
            &format!("{}/latest.json", server.uri()),
            &key,
            "1.1.0",
            fake_executable(root.path()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(update.version, "1.2.0");
        let bytes = blocking("test updater", move || {
            update.package.download().map_err(Error::from)
        })
        .await
        .unwrap();
        assert_eq!(bytes, b"new signed application");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn updates_install_verified_package_and_preserve_user_data() {
        use std::os::unix::fs::PermissionsExt;
        let (server, key) = release("1.2.0", false).await;
        let root = tempfile::tempdir().unwrap();
        let executable = fake_executable(root.path());
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let database = root.path().join("study.sqlite");
        std::fs::write(&database, b"user data").unwrap();
        let update = check_at(
            &format!("{}/latest.json", server.uri()),
            &key,
            "1.1.0",
            executable.clone(),
        )
        .await
        .unwrap()
        .unwrap();
        update.install().await.unwrap();
        assert_eq!(
            std::fs::read(&executable).unwrap(),
            b"new signed application"
        );
        assert_eq!(
            std::fs::metadata(executable).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert_eq!(std::fs::read(database).unwrap(), b"user data");
    }

    #[tokio::test]
    async fn updates_reject_tampering_before_replacing_any_file() {
        let (server, key) = release("1.2.0", true).await;
        let root = tempfile::tempdir().unwrap();
        let executable = fake_executable(root.path());
        let update = check_at(
            &format!("{}/latest.json", server.uri()),
            &key,
            "1.1.0",
            executable.clone(),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(matches!(
            update.install().await,
            Err(Error::Update(cargo_packager_updater::Error::Minisign(_)))
        ));
        assert_eq!(std::fs::read(executable).unwrap(), b"old application");
    }

    #[tokio::test]
    async fn updates_do_not_offer_equal_or_older_releases() {
        let (server, key) = release("1.2.0", false).await;
        for current in ["1.2.0", "2.0.0"] {
            assert!(
                check_at(
                    &format!("{}/latest.json", server.uri()),
                    &key,
                    current,
                    PathBuf::new()
                )
                .await
                .unwrap()
                .is_none()
            );
        }
    }

    #[tokio::test]
    async fn updates_report_http_errors_without_touching_the_application() {
        let server = MockServer::start().await;
        Mock::given(path("/latest.json"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let error = check_at(
            &format!("{}/latest.json", server.uri()),
            "",
            "1.0.0",
            PathBuf::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Transient);
    }
}
