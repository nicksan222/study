//! Where the app keeps its files on each platform.

use std::{
    fs,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;

use crate::{Context as _, Result};

fn project() -> Option<ProjectDirs> {
    ProjectDirs::from("", "", "Study")
}

/// Data the user would miss: the database. `None` if the platform has no home directory.
fn data_dir() -> Option<PathBuf> {
    project().map(|dirs| dirs.data_local_dir().to_owned())
}

/// Data that can be fetched again, such as downloaded models.
pub fn cache_dir() -> Option<PathBuf> {
    project().map(|dirs| dirs.cache_dir().to_owned())
}

/// The file `name` among the data the user would miss, such as the database, creating
/// their directory on first launch.
pub fn data_file(name: &str) -> Result<PathBuf> {
    let dir = data_dir().context("cannot locate app data directory")?;
    create_private_dir(&dir).context("cannot create app data directory")?;
    Ok(dir.join(name))
}

/// Creates `dir` and any missing parents. On Unix `dir` itself is open to its owner only,
/// whether it is new or already there, since it holds the user's notes and sign-ins.
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
        if dir.is_dir() {
            return fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
        if let Some(parent) = dir.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::DirBuilder::new().mode(0o700).create(dir)
    }
    #[cfg(not(unix))]
    fs::create_dir_all(dir)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn the_data_directory_is_private_new_or_existing() -> Result<()> {
        let home = tempfile::tempdir()?;
        let dir = home.path().join("share").join("Study");
        create_private_dir(&dir)?;
        assert_eq!(mode(&dir), 0o700);

        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755))?;
        create_private_dir(&dir)?;
        assert_eq!(mode(&dir), 0o700, "an existing install is fixed too");
        Ok(())
    }
}
