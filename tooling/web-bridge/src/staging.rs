//! Per-capability file staging. Only registered, unchanged canonical regular files are readable.
//! A batch owns its temporary directories until it commits, so every rejected upload rolls back.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use study_rpc::tonic::Status;
use tempfile::TempDir;

const MAX_FILES: usize = 128;
const MAX_BYTES: u64 = 512 * 1024 * 1024;

pub struct Staging {
    root: TempDir,
    files: HashMap<PathBuf, StagedFile>,
    bytes: u64,
    max_files: usize,
    max_bytes: u64,
}
pub struct StagedFile {
    path: PathBuf,
    bytes: u64,
    _folder: TempDir,
    #[cfg(unix)]
    identity: (u64, u64),
}
impl Staging {
    pub fn new() -> Result<Self, Status> {
        Ok(Self {
            root: tempfile::tempdir().map_err(io)?,
            files: HashMap::new(),
            bytes: 0,
            max_files: MAX_FILES,
            max_bytes: MAX_BYTES,
        })
    }
    pub async fn stage(
        &self,
        batch: &mut Vec<StagedFile>,
        filename: &str,
        bytes: &[u8],
    ) -> Result<(), Status> {
        let path = Path::new(filename);
        if filename.is_empty()
            || path.file_name().and_then(|name| name.to_str()) != Some(filename)
            || filename.contains('\\')
        {
            return Err(Status::invalid_argument("invalid upload filename"));
        }
        if bytes.is_empty() {
            return Err(Status::invalid_argument("empty upload"));
        }
        let batch_bytes: u64 = batch.iter().map(|file| file.bytes).sum();
        if self.files.len() + batch.len() >= self.max_files
            || (bytes.len() as u64) > self.max_bytes.saturating_sub(self.bytes + batch_bytes)
        {
            return Err(Status::resource_exhausted(
                "session staging quota exceeded (128 files / 512 MiB)",
            ));
        }
        let root = self.root.path().canonicalize().map_err(io)?;
        let folder = tempfile::tempdir_in(root).map_err(io)?;
        let output = folder.path().join(filename);
        tokio::fs::write(&output, bytes).await.map_err(io)?;
        #[cfg(unix)]
        let metadata = std::fs::metadata(&output).map_err(io)?;
        batch.push(StagedFile {
            path: output,
            bytes: bytes.len() as u64,
            _folder: folder,
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (metadata.dev(), metadata.ino())
            },
        });
        Ok(())
    }
    pub fn commit(&mut self, batch: Vec<StagedFile>) -> Vec<String> {
        batch
            .into_iter()
            .map(|file| {
                let path = file.path.clone();
                self.bytes += file.bytes;
                self.files.insert(path.clone(), file);
                path.to_string_lossy().into_owned()
            })
            .collect()
    }
    /// Exact ownership plus canonical identity rejects relative aliases and symlink substitution.
    /// The caller retains this arena's mutex through gRPC, preventing release/cleanup races.
    pub fn readable(&self, raw: &str) -> Result<String, Status> {
        let denied = || Status::permission_denied("path is not an owned staged file");
        let path = Path::new(raw);
        let file = self.files.get(path).ok_or_else(denied)?;
        let metadata = path.symlink_metadata().map_err(|_| denied())?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() != file.bytes
            || path.canonicalize().map_err(|_| denied())? != file.path
        {
            return Err(denied());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if (metadata.dev(), metadata.ino()) != file.identity {
                return Err(denied());
            }
        }
        Ok(file.path.to_string_lossy().into_owned())
    }
    /// Foreign/noncanonical paths are deliberately ignored and never unlinked.
    pub fn release(&mut self, paths: &[String]) {
        for path in paths {
            if let Some(file) = self.files.remove(Path::new(path)) {
                self.bytes -= file.bytes;
            }
        }
    }
}
fn io(error: impl std::fmt::Display) -> Status {
    tracing::error!(%error, "staging operation failed");
    Status::internal("staging operation failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn aggregate_byte_quota_rolls_back_and_release_restores_capacity() {
        let mut arena = Staging::new().unwrap();
        arena.max_bytes = 8;
        let mut batch = Vec::new();
        arena
            .stage(&mut batch, "first.txt", b"123456")
            .await
            .unwrap();
        let paths = arena.commit(batch);
        let mut batch = Vec::new();
        assert_eq!(
            arena
                .stage(&mut batch, "next.txt", b"789")
                .await
                .unwrap_err()
                .code(),
            study_rpc::tonic::Code::ResourceExhausted
        );
        assert_eq!(std::fs::read_dir(arena.root.path()).unwrap().count(), 1);
        arena.release(&paths);
        arena.stage(&mut batch, "next.txt", b"789").await.unwrap();
        assert_eq!(arena.commit(batch).len(), 1);
    }
}
