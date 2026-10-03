//! The diagnostic log: an append-only file of the app's recent log lines.
//!
//! The desktop sends every `tracing` event here as well as to stderr, so a problem can be
//! looked into after the fact. The file keeps the last [`KEPT_LINES`] lines: it grows by up to
//! a tenth more, then drops its oldest lines in one rewrite, so a write rarely costs more
//! than an append. The rewrite is in place, so another running instance, appending to the
//! same file, keeps writing to it.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use study_core::{Context as _, Result};

/// How many of the most recent lines the log keeps.
pub const KEPT_LINES: usize = 10_000;

const LOG_FILE: &str = "diagnostics.log";

/// The diagnostic log file. It implements [`Write`]; each write is appended at once, never
/// buffered, so the lines before the app crashes are in the file.
#[derive(Debug)]
pub struct DiagnosticLog {
    path: PathBuf,
    file: File,
    /// Lines in the file since it was last trimmed.
    lines: usize,
    /// Lines kept after a trim.
    keep: usize,
}

impl DiagnosticLog {
    /// Opens the log in the platform's data directory, beside the database, creating the
    /// directory on first launch.
    pub fn open_default() -> Result<Self> {
        Self::open(study_core::paths::data_file(LOG_FILE)?)
    }

    /// Opens the log at `path` for appending, creating it if needed and dropping all but
    /// its last `KEPT_LINES` lines.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::keeping(path, KEPT_LINES)
    }

    fn keeping(path: impl AsRef<Path>, keep: usize) -> Result<Self> {
        let path = path.as_ref().to_owned();
        let file = append(&path).context("cannot open the diagnostic log")?;
        let lines = lines(&fs::read(&path).context("cannot read the diagnostic log")?).count();
        let mut log = Self {
            path,
            file,
            lines,
            keep,
        };
        if log.lines > log.keep {
            log.trim().context("cannot trim the diagnostic log")?;
        }
        Ok(log)
    }

    /// The log file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The most lines the file holds before it is trimmed.
    fn limit(&self) -> usize {
        self.keep + (self.keep / 10).max(1)
    }

    /// Rewrites the file with only its last `keep` lines. It truncates in place rather than
    /// renaming a new file over it: every handle, this one and another instance's, is in
    /// append mode, so each carries on at the new end.
    fn trim(&mut self) -> io::Result<()> {
        // Counted before trying, so a failing trim is retried when the headroom fills again,
        // not on every line.
        self.lines = self.keep;
        let contents = fs::read(&self.path)?;
        let kept: usize = lines(&contents)
            .rev()
            .take(self.keep)
            .map(<[u8]>::len)
            .sum();
        fs::write(&self.path, &contents[contents.len() - kept..])
    }
}

impl Write for DiagnosticLog {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.file.write_all(buf)?;
        self.lines += buf.iter().filter(|&&byte| byte == b'\n').count();
        if self.lines > self.limit()
            && let Err(error) = self.trim()
        {
            // The line is written either way. Logging through `tracing` from here would
            // deadlock on this writer, so the failure goes into the file itself.
            writeln!(self.file, "cannot trim the diagnostic log: {error}")?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// Opens the log to append to it, creating it readable only by its owner where the system
/// says who that is: it can hold file names and what went wrong with them.
fn append(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

/// The lines of `contents`, each with its newline; an unfinished last line counts too.
fn lines(contents: &[u8]) -> impl DoubleEndedIterator<Item = &[u8]> {
    contents.split_inclusive(|&byte| byte == b'\n')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_lines(path: &Path) -> Vec<String> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn appends_to_what_is_already_there() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(LOG_FILE);
        fs::write(&path, "earlier\n")?;
        let mut log = DiagnosticLog::open(&path)?;
        log.write_all(b"now\n")?;
        assert_eq!(read_lines(&path), ["earlier", "now"]);
        Ok(())
    }

    #[test]
    fn keeps_only_the_last_lines_once_past_the_limit() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(LOG_FILE);
        let mut log = DiagnosticLog::keeping(&path, 10)?;
        for line in 0..11 {
            writeln!(log, "{line}")?;
        }
        assert_eq!(
            read_lines(&path).len(),
            11,
            "within the headroom, nothing is dropped"
        );
        writeln!(log, "11")?;
        let expected: Vec<String> = (2..12).map(|line| line.to_string()).collect();
        assert_eq!(read_lines(&path), expected);
        writeln!(log, "12")?;
        assert_eq!(read_lines(&path).last().map(String::as_str), Some("12"));
        Ok(())
    }

    #[test]
    fn another_instance_keeps_appending_after_a_trim() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(LOG_FILE);
        let mut first = DiagnosticLog::keeping(&path, 10)?;
        let mut second = DiagnosticLog::keeping(&path, 10)?;
        for line in 0..12 {
            writeln!(first, "{line}")?;
        }
        writeln!(second, "second")?;
        let lines = read_lines(&path);
        assert_eq!(lines.len(), 11);
        assert_eq!(lines.last().map(String::as_str), Some("second"));
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_trim_keeps_the_line_and_waits_for_the_headroom() -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(LOG_FILE);
        let mut log = DiagnosticLog::keeping(&path, 2)?;
        // Write-only: the log still appends, but the trim cannot read the file.
        fs::set_permissions(&path, fs::Permissions::from_mode(0o200))?;
        if fs::read(&path).is_ok() {
            return Ok(()); // Running as root, which reads it anyway.
        }
        for line in 0..5 {
            writeln!(log, "{line}")?;
        }
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        let lines = read_lines(&path);
        let failures = lines
            .iter()
            .filter(|line| line.starts_with("cannot trim"))
            .count();
        assert_eq!(failures, 1, "{lines:?}");
        assert_eq!(lines.len(), 6);
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn a_new_log_is_readable_only_by_its_owner() -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(LOG_FILE);
        DiagnosticLog::open(&path)?;
        assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
        Ok(())
    }

    #[test]
    fn trims_a_long_file_when_opened() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(LOG_FILE);
        let old: String = (0..30).map(|line| format!("{line}\n")).collect();
        fs::write(&path, old)?;
        let log = DiagnosticLog::keeping(&path, 10)?;
        assert_eq!(log.lines, 10);
        let expected: Vec<String> = (20..30).map(|line| line.to_string()).collect();
        assert_eq!(read_lines(&path), expected);
        Ok(())
    }
}
