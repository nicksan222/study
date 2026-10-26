//! Bounded child execution and Linux process-exit observation.
use crate::Result;
use std::{process::Output, time::Duration};
use tokio::{process::Command, time::timeout};

pub async fn output(command: &mut Command, budget: Duration) -> Result<Output> {
    if budget.is_zero() {
        return Err("desktop IPC timed out".into());
    }
    timeout(budget, command.kill_on_drop(true).output())
        .await
        .map_err(|_| "desktop IPC timed out")?
        .map_err(Into::into)
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy)]
enum Target {
    Process(u32),
    Group(u32),
}
#[cfg(any(target_os = "linux", test))]
impl std::str::FromStr for Target {
    type Err = &'static str;
    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        let error = "expected a PID or negative process-group ID greater than 1";
        let value: i32 = value.parse().map_err(|_| error)?;
        match value {
            2.. => Ok(Self::Process(value as u32)),
            ..=-2 => value
                .checked_abs()
                .map(|group| Self::Group(group as u32))
                .ok_or(error),
            _ => Err(error),
        }
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Debug)]
struct Stat {
    live: bool,
    group: u32,
}

#[cfg(any(target_os = "linux", test))]
fn stat(source: &[u8]) -> std::io::Result<Stat> {
    use std::io::{Error, ErrorKind};
    let invalid = || Error::new(ErrorKind::InvalidData, "malformed process stat");
    // Only the fields after comm are textual: a Linux task name need not be UTF-8.
    let end = source
        .windows(2)
        .rposition(|pair| pair == b") ")
        .ok_or_else(invalid)?;
    let fields = std::str::from_utf8(&source[end + 2..]).map_err(|_| invalid())?;
    let mut fields = fields.split_ascii_whitespace();
    let state = fields
        .next()
        .filter(|state| state.len() == 1)
        .ok_or_else(invalid)?;
    fields
        .next()
        .ok_or_else(invalid)?
        .parse::<u32>()
        .map_err(|_| invalid())?;
    let group = fields
        .next()
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())?;
    Ok(Stat {
        live: !matches!(state, "Z" | "X"),
        group,
    })
}

#[cfg(any(target_os = "linux", test))]
fn read(root: &std::path::Path, pid: u32) -> std::io::Result<Option<Stat>> {
    match std::fs::read(root.join(pid.to_string()).join("stat")) {
        Ok(source) => stat(&source).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "linux")]
pub fn pid_alive(pid: u32) -> bool {
    read(std::path::Path::new("/proc"), pid)
        .ok()
        .flatten()
        .is_some_and(|stat| stat.live)
}

#[cfg(any(target_os = "linux", test))]
fn active(target: Target, root: &std::path::Path) -> std::io::Result<bool> {
    if !std::fs::metadata(root)?.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            "process filesystem is unavailable",
        ));
    }
    let group = match target {
        Target::Process(pid) => return Ok(read(root, pid)?.is_some_and(|stat| stat.live)),
        Target::Group(group) => group,
    };
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        if read(root, pid)?.is_some_and(|stat| stat.group == group && stat.live) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(any(target_os = "linux", test))]
async fn wait(target: Target, root: &std::path::Path, budget: Duration) -> Result<bool> {
    let deadline = tokio::time::Instant::now()
        .checked_add(budget)
        .ok_or("process wait timeout is too large")?;
    loop {
        if !active(target, root)? {
            return Ok(true);
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Ok(false);
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(100))).await;
    }
}

pub async fn wait_exit(value: &std::ffi::OsStr) -> Result<bool> {
    #[cfg(target_os = "linux")]
    {
        let target = value
            .to_str()
            .ok_or("invalid process identifier")?
            .parse::<Target>()?;
        wait(
            target,
            std::path::Path::new("/proc"),
            Duration::from_secs(5),
        )
        .await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = value;
        Err("process exit waiting is supported only on Linux".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path};

    fn entry(root: &Path, pid: u32, state: &str, group: u32) {
        fs::create_dir_all(root.join(pid.to_string())).unwrap();
        fs::write(
            root.join(pid.to_string()).join("stat"),
            format!("{pid} (odd ) (process name) {state} 1 {group} 0\n"),
        )
        .unwrap();
    }

    #[test]
    fn group_wait_ignores_unrelated_processes_and_finished_members() {
        let root = tempfile::tempdir().unwrap();
        entry(root.path(), 41, "Z", 73);
        entry(root.path(), 42, "R", 74);
        entry(root.path(), 43, "X", 73);
        assert!(!active(Target::Group(73), root.path()).unwrap());
        assert!(active(Target::Process(42), root.path()).unwrap());
        entry(root.path(), 44, "S", 73);
        assert!(active(Target::Group(73), root.path()).unwrap());
        fs::remove_dir_all(root.path().join("44")).unwrap();
        assert!(!active(Target::Group(73), root.path()).unwrap());
        assert!(!active(Target::Process(999), root.path()).unwrap());
    }

    #[test]
    fn command_names_with_spaces_and_parentheses_do_not_shift_stat_fields() {
        let value = stat(b"44 (odd ) (process name) S 1 73 0\n").unwrap();
        assert!(value.live);
        assert_eq!(value.group, 73);
        assert!(stat(b"44 (invalid-\xff-name) S 1 73 0\n").unwrap().live);
        for value in ["", "44 name S 1 73", "44 (name) S", "44 (name) S 1 bad"] {
            assert!(stat(value.as_bytes()).is_err());
        }
    }

    #[test]
    fn unreadable_or_malformed_proc_data_cannot_report_successful_shutdown() {
        let root = tempfile::tempdir().unwrap();
        entry(root.path(), 41, "S", 73);
        fs::write(root.path().join("41/stat"), "corrupt").unwrap();
        assert!(active(Target::Process(41), root.path()).is_err());
        assert!(active(Target::Group(73), root.path()).is_err());
        fs::remove_file(root.path().join("41/stat")).unwrap();
        fs::create_dir(root.path().join("41/stat")).unwrap();
        assert!(active(Target::Process(41), root.path()).is_err());
        assert!(active(Target::Group(73), &root.path().join("missing-proc")).is_err());
    }

    #[test]
    fn only_safe_pid_and_group_identifiers_are_accepted() {
        for value in ["0", "1", "-1", "-2147483648", "2147483648", "", "garbage"] {
            assert!(value.parse::<Target>().is_err(), "{value}");
        }
        assert!(matches!("42".parse::<Target>(), Ok(Target::Process(42))));
        assert!(matches!("-42".parse::<Target>(), Ok(Target::Group(42))));
    }

    #[cfg(target_os = "linux")]
    struct Child(std::process::Child);
    #[cfg(target_os = "linux")]
    impl Drop for Child {
        fn drop(&mut self) {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(self.0.id() as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
            let _ = self.0.wait();
        }
    }
    #[cfg(target_os = "linux")]
    fn child(script: &str) -> Child {
        use std::os::unix::process::CommandExt;
        Child(
            std::process::Command::new("sh")
                .args(["-c", script])
                .process_group(0)
                .spawn()
                .unwrap(),
        )
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn an_unreaped_child_is_finished_even_though_kill_zero_still_finds_it() {
        let child = child("exit 0");
        let pid = child.0.id();
        let root = Path::new("/proc");
        assert!(
            wait(Target::Process(pid), root, Duration::from_secs(1))
                .await
                .unwrap()
        );
        assert!(read(root, pid).unwrap().is_some_and(|stat| !stat.live));
        assert!(nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_ok());
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn a_real_group_is_pending_until_all_members_exit() {
        let child = child("sleep 30 & wait");
        let group = child.0.id();
        let root = Path::new("/proc");
        assert!(
            !wait(Target::Group(group), root, Duration::from_millis(30))
                .await
                .unwrap()
        );
        assert!(read(root, group).unwrap().unwrap().live);
        nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(group as i32),
            nix::sys::signal::Signal::SIGTERM,
        )
        .unwrap();
        assert!(
            wait(Target::Group(group), root, Duration::from_secs(1))
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn live_process_reaches_the_deadline_without_being_signaled() {
        let root = tempfile::tempdir().unwrap();
        entry(root.path(), 41, "S", 73);
        let before = std::time::Instant::now();
        assert!(
            !wait(Target::Process(41), root.path(), Duration::from_millis(30))
                .await
                .unwrap()
        );
        assert!(before.elapsed() < Duration::from_secs(1));
        assert!(active(Target::Process(41), root.path()).unwrap());
    }
}
