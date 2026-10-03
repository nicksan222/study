//! Images pasted into a composer, saved as files so they attach like any other until the
//! note is sent (which copies them into the Library).

use std::path::PathBuf;

use study_core::Context as _;

/// Where pasted images wait to be sent; the files go when it is dropped, with the app.
#[derive(Default)]
pub struct PastedImages {
    folder: Option<tempfile::TempDir>,
}

impl PastedImages {
    /// Saves `bytes` as `name`, in a folder of its own named by the clipboard's `id` for
    /// it, so two images pasted with the same name keep their own files.
    pub fn save(&mut self, id: u64, name: &str, bytes: &[u8]) -> study_core::Result<PathBuf> {
        let base = match &self.folder {
            Some(folder) => folder,
            None => self
                .folder
                .insert(tempfile::tempdir().context("cannot make a place for pasted images")?),
        };
        let folder = base.path().join(id.to_string());
        std::fs::create_dir_all(&folder).context("cannot make a place for a pasted image")?;
        let path = folder.join(name);
        std::fs::write(&path, bytes).context("cannot save a pasted image")?;
        Ok(path)
    }
}
