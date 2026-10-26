//! Private, bounded staging for pasted files. The canonical service imports these paths;
//! releasing a path can only remove a file owned by this arena, never an original file.
use crate::rpc::RpcError;
use std::{collections::HashMap, path::Path, sync::Mutex};

pub struct Staging {
    directory: tempfile::TempDir,
    entries: Mutex<HashMap<String, Staged>>,
}
struct Staged {
    _directory: tempfile::TempDir,
    bytes: usize,
}
impl Staging {
    pub fn new() -> std::io::Result<Self> {
        Ok(Self {
            directory: tempfile::Builder::new().prefix("study-pastes-").tempdir()?,
            entries: Mutex::new(HashMap::new()),
        })
    }
    fn stage(&self, name: &str, bytes: &[u8]) -> Result<String, RpcError> {
        let name_path = Path::new(name);
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.contains(['\\', '\0'])
            || name_path.file_name().and_then(|name| name.to_str()) != Some(name)
        {
            return Err(RpcError::invalid("invalid pasted filename"));
        }
        if bytes.is_empty() || bytes.len() as u64 > study_core::db::MAX_SOURCE_BYTES {
            return Err(RpcError::invalid("invalid pasted file size"));
        }
        let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        let used: usize = entries.values().map(|entry| entry.bytes).sum();
        if entries.len() >= 128
            || used.saturating_add(bytes.len()) as u64 > study_core::db::MAX_SOURCE_BYTES
        {
            return Err(tonic::Status::resource_exhausted("pasted file staging is full").into());
        }
        let directory = tempfile::tempdir_in(self.directory.path())
            .map_err(|_| RpcError::internal("cannot stage pasted file"))?;
        let path = directory.path().join(name);
        std::fs::write(&path, bytes).map_err(|_| RpcError::internal("cannot stage pasted file"))?;
        let path = path.to_string_lossy().into_owned();
        entries.insert(
            path.clone(),
            Staged {
                _directory: directory,
                bytes: bytes.len(),
            },
        );
        Ok(path)
    }
    fn release(&self, paths: &[String]) {
        let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        for path in paths {
            entries.remove(path);
        }
    }
}
#[tauri::command]
pub async fn stage_file(
    staging: tauri::State<'_, std::sync::Arc<Staging>>,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, RpcError> {
    let staging = staging.inner().clone();
    tauri::async_runtime::spawn_blocking(move || staging.stage(&name, &bytes))
        .await
        .map_err(|_| RpcError::internal("file staging failed"))?
}
#[tauri::command]
pub async fn release_files(
    staging: tauri::State<'_, std::sync::Arc<Staging>>,
    paths: Vec<String>,
) -> Result<(), RpcError> {
    let staging = staging.inner().clone();
    tauri::async_runtime::spawn_blocking(move || staging.release(&paths))
        .await
        .map_err(|_| RpcError::internal("file staging cleanup failed"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pasted_bytes_keep_their_name_and_releasing_never_deletes_an_original() {
        let arena = Staging::new().unwrap();
        let original = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(original.path(), b"original").unwrap();
        let pasted = arena.stage("pasted.png", b"image bytes").unwrap();
        assert_eq!(Path::new(&pasted).file_name().unwrap(), "pasted.png");
        assert_eq!(std::fs::read(&pasted).unwrap(), b"image bytes");
        arena.release(&[
            original.path().to_string_lossy().into_owned(),
            pasted.clone(),
        ]);
        assert!(!Path::new(&pasted).exists());
        assert_eq!(std::fs::read(original.path()).unwrap(), b"original");
    }
    #[test]
    fn duplicate_names_are_isolated_and_app_exit_cleans_unused_pastes() {
        let first;
        let second;
        {
            let arena = Staging::new().unwrap();
            first = arena.stage("same.txt", b"one").unwrap();
            second = arena.stage("same.txt", b"two").unwrap();
            assert_ne!(first, second);
            assert_eq!(std::fs::read(&first).unwrap(), b"one");
            assert_eq!(std::fs::read(&second).unwrap(), b"two");
        }
        assert!(!Path::new(&first).exists());
        assert!(!Path::new(&second).exists());
    }
    #[test]
    fn discarded_pastes_release_the_bounded_staging_capacity() {
        let arena = Staging::new().unwrap();
        let mut paths = Vec::new();
        for _ in 0..128 {
            paths.push(arena.stage("paste.txt", b"x").unwrap());
        }
        let error = arena.stage("paste.txt", b"x").unwrap_err();
        assert_eq!(error.code, tonic::Code::ResourceExhausted as i32);
        arena.release(&paths);
        assert!(arena.stage("new.txt", b"replacement").is_ok());
    }
    #[test]
    fn invalid_pasted_names_and_empty_data_are_rejected() {
        let arena = Staging::new().unwrap();
        for name in [
            "",
            "..",
            ".",
            "../secret",
            "/absolute",
            "folder/name",
            "folder\\name",
            "bad\0name",
        ] {
            assert!(arena.stage(name, b"contents").is_err(), "{name:?}");
        }
        assert!(arena.stage("empty.txt", &[]).is_err());
    }
}
