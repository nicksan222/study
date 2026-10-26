//! Own one private session bus for the development desktop.
#![allow(clippy::print_stdout)] // JSON or a shell-consumable address is the CLI output.

use std::{
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
#[cfg(target_os = "linux")]
use tokio::time::{Instant, sleep};

use crate::Result;

#[cfg(target_os = "linux")]
const START_BUDGET: Duration = Duration::from_secs(5);
const PROBE_BUDGET: Duration = Duration::from_secs(2);

#[derive(serde::Serialize)]
pub struct Status {
    pub dbus: bool,
    pub pid: Option<u32>,
    pub address: String,
    pub owned: bool,
}

// Resolve existing ancestors as well as missing suffixes, like Path.resolve(strict=False).
fn resolved(path: &Path) -> PathBuf {
    if let Ok(path) = path.canonicalize() {
        return path;
    }
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut result = PathBuf::new();
    for part in absolute.components() {
        match part {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            part => {
                result.push(part.as_os_str());
                if let Ok(canonical) = result.canonicalize() {
                    result = canonical;
                }
            }
        }
    }
    result
}

pub fn address(state: &Path) -> String {
    let socket = resolved(state).join("dbus.sock");
    let mut address = String::from("unix:path=");
    for &byte in socket.as_os_str().as_encoded_bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
            address.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _ = write!(address, "%{byte:02X}");
        }
    }
    address
}

fn pid_from(state: &Path) -> Result<Option<u32>> {
    let text = match fs::read_to_string(state.join("dbus.pid")) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let pid = text.trim().parse::<u32>().ok().filter(|pid| *pid > 1);
    pid.map(Some)
        .ok_or_else(|| "desktop D-Bus: malformed dbus.pid; left untouched".into())
}

#[cfg(target_os = "linux")]
fn alive(pid: u32) -> bool {
    fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| {
            stat.rsplit_once(") ").map(|(_, fields)| {
                !matches!(fields.split_whitespace().next(), None | Some("Z" | "X"))
            })
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn owned(pid: u32, bus: &str) -> bool {
    use std::os::unix::fs::MetadataExt;
    let process = PathBuf::from(format!("/proc/{pid}"));
    let Ok(metadata) = fs::metadata(&process) else {
        return false;
    };
    if metadata.uid() != nix::unistd::getuid().as_raw() || !alive(pid) {
        return false;
    }
    let Ok(command) = fs::read(process.join("cmdline")) else {
        return false;
    };
    let args: Vec<_> = command.split(|byte| *byte == 0).collect();
    // Only argv[0] identifies the program; a foreign process can mention dbus-daemon in an argument.
    let daemon = args.first().is_some_and(|arg| {
        arg.rsplit(|byte| *byte == b'/').next() == Some(b"dbus-daemon".as_slice())
    });
    daemon && args.contains(&format!("--address={bus}").as_bytes())
}

#[cfg(not(target_os = "linux"))]
fn owned(_: u32, _: &str) -> bool {
    false
}

async fn probe(bus: &str, budget: Duration) -> bool {
    crate::process::output(
        Command::new("dbus-send")
            .args([
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus.ListNames",
            ])
            .env("DBUS_SESSION_BUS_ADDRESS", bus),
        budget,
    )
    .await
    .is_ok_and(|output| output.status.success())
}

pub async fn status(state: &Path, budget: Duration) -> Status {
    let address = address(state);
    let pid = pid_from(state)
        .ok()
        .flatten()
        .filter(|pid| owned(*pid, &address));
    Status {
        dbus: pid.is_some() && probe(&address, budget).await,
        owned: pid.is_some(),
        pid,
        address,
    }
}

#[cfg(target_os = "linux")]
async fn locked(state: &Path) -> Result<fs::File> {
    fs::create_dir_all(state)?;
    // Rust opens files close-on-exec. Neither dbus-daemon nor probes inherit this lock.
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.join("dbus.lock"))?;
    let deadline = Instant::now() + START_BUDGET;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                sleep(Duration::from_millis(20)).await
            }
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err("desktop D-Bus: lock timed out".into());
            }
            Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
        }
    }
}

#[cfg(target_os = "linux")]
fn remove(path: &Path) -> Result {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "linux")]
fn signal_owned(pid: u32, bus: &str) -> Result {
    use nix::{
        sys::signal::{Signal, kill, killpg},
        unistd::{Pid, getpgid},
    };
    if !owned(pid, bus) {
        return Err("desktop D-Bus: process ownership changed; left untouched".into());
    }
    let pid = Pid::from_raw(i32::try_from(pid)?);
    let result = if getpgid(Some(pid))? == pid {
        killpg(pid, Signal::SIGTERM)
    } else {
        kill(pid, Signal::SIGTERM)
    };
    match result {
        Ok(()) | Err(nix::errno::Errno::ESRCH) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "linux")]
async fn stop_process(pid: u32, bus: &str) -> Result {
    signal_owned(pid, bus)?;
    let deadline = Instant::now() + START_BUDGET;
    while alive(pid) {
        if !owned(pid, bus) {
            return Err("desktop D-Bus: process ownership changed; left untouched".into());
        }
        if Instant::now() >= deadline {
            return Err("desktop D-Bus: managed bus is still stopping".into());
        }
        sleep(Duration::from_millis(20)).await;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn export_environment(path: &Path, bus: &str) -> Result {
    let source = match fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let mut lines: Vec<_> = source
        .lines()
        .filter(|line| !line.starts_with("export DBUS_SESSION_BUS_ADDRESS="))
        .map(str::to_owned)
        .collect();
    lines.push(format!(
        "export DBUS_SESSION_BUS_ADDRESS={}",
        shlex::try_quote(bus)?
    ));
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or(Path::new(".")),
    )?;
    use std::io::Write;
    writeln!(temporary, "{}", lines.join("\n"))?;
    temporary.persist(path)?;
    Ok(())
}

// Spawn with explicit close actions: callers can hold non-CLOEXEC desktop locks.
#[cfg(target_os = "linux")]
fn spawn_daemon(state: &Path, bus: &str) -> Result<nix::unistd::Pid> {
    use nix::spawn::{PosixSpawnAttr, PosixSpawnFileActions, PosixSpawnFlags, posix_spawnp};
    use std::{
        ffi::CString,
        os::{
            fd::{AsFd, AsRawFd},
            unix::ffi::OsStrExt,
        },
    };
    // Clone above stdio even when a caller has closed descriptor 0, 1 or 2.
    let log = fs::File::create(state.join("dbus.log"))?
        .as_fd()
        .try_clone_to_owned()?;
    let input = fs::File::open("/dev/null")?.as_fd().try_clone_to_owned()?;
    let mut actions = PosixSpawnFileActions::init()?;
    actions.add_dup2(input.as_raw_fd(), 0)?;
    actions.add_dup2(log.as_raw_fd(), 1)?;
    actions.add_dup2(log.as_raw_fd(), 2)?;
    for entry in fs::read_dir("/proc/self/fd")? {
        let entry = entry?;
        if let Some(fd) = entry
            .file_name()
            .to_str()
            .and_then(|fd| fd.parse::<i32>().ok())
            .filter(|fd| *fd > 2)
        {
            actions.add_close(fd)?;
        }
    }
    let mut attributes = PosixSpawnAttr::init()?;
    attributes.set_pgroup(nix::unistd::Pid::from_raw(0))?;
    attributes.set_flags(PosixSpawnFlags::POSIX_SPAWN_SETPGROUP)?;
    let args = [
        CString::new("dbus-daemon")?,
        CString::new("--session")?,
        CString::new("--nofork")?,
        CString::new("--nopidfile")?,
        CString::new(format!("--address={bus}"))?,
    ];
    let environment: Vec<CString> = std::env::vars_os()
        .map(|(key, value)| {
            let mut bytes = key.as_os_str().as_bytes().to_vec();
            bytes.push(b'=');
            bytes.extend_from_slice(value.as_os_str().as_bytes());
            CString::new(bytes)
        })
        .collect::<std::result::Result<_, _>>()?;
    Ok(posix_spawnp(
        &args[0],
        &actions,
        &attributes,
        &args,
        &environment,
    )?)
}

#[cfg(target_os = "linux")]
fn reap(pid: nix::unistd::Pid) {
    use nix::sys::wait::{WaitPidFlag, WaitStatus, waitpid};
    tokio::spawn(async move {
        loop {
            match waitpid(pid, Some(WaitPidFlag::WNOHANG)) {
                Ok(WaitStatus::StillAlive) => sleep(Duration::from_millis(20)).await,
                Err(nix::errno::Errno::EINTR) => continue,
                _ => break,
            }
        }
    });
}

// The unreaped child PID cannot be reused before this guard releases it.
#[cfg(target_os = "linux")]
struct Starting<'a> {
    pid: Option<nix::unistd::Pid>,
    state: &'a Path,
    ready: bool,
}

#[cfg(target_os = "linux")]
impl Drop for Starting<'_> {
    fn drop(&mut self) {
        if !self.ready {
            if let Some(pid) = self.pid {
                let _ = nix::sys::signal::kill(pid, nix::sys::signal::Signal::SIGKILL);
            }
            let _ = remove(&self.state.join("dbus.pid"));
            let _ = remove(&self.state.join("dbus.sock"));
        }
        if let Some(pid) = self.pid {
            reap(pid);
        }
    }
}

#[cfg(target_os = "linux")]
async fn start(state: &Path, bus: &str) -> Result<Status> {
    use nix::sys::wait::{WaitPidFlag, WaitStatus, waitpid};
    let child = spawn_daemon(state, bus)?;
    let mut starting = Starting {
        pid: Some(child),
        state,
        ready: false,
    };
    let pid = u32::try_from(child.as_raw())?;
    fs::write(state.join("dbus.pid"), format!("{pid}\n"))?;
    let deadline = Instant::now() + START_BUDGET;
    loop {
        match waitpid(child, Some(WaitPidFlag::WNOHANG))? {
            WaitStatus::StillAlive => {}
            _ => {
                starting.pid = None;
                return Err("desktop D-Bus: did not start; inspect dbus.log".into());
            }
        }
        if Instant::now() >= deadline {
            return Err("desktop D-Bus: did not start; inspect dbus.log".into());
        }
        let current = status(
            state,
            deadline
                .saturating_duration_since(Instant::now())
                .min(PROBE_BUDGET),
        )
        .await;
        if current.dbus {
            starting.ready = true;
            return Ok(current);
        }
        sleep(Duration::from_millis(20)).await;
    }
}

#[cfg(target_os = "linux")]
pub(crate) async fn ensure(state: &Path, env_file: Option<&Path>) -> Result<Status> {
    let _lock = locked(state).await?;
    let bus = address(state);
    let pid = pid_from(state)?;
    if let Some(pid) = pid.filter(|pid| alive(*pid)) {
        if !owned(pid, &bus) {
            return Err(format!(
                "desktop D-Bus: dbus.pid names unrelated PID {pid}; left untouched"
            )
            .into());
        }
        let current = status(state, PROBE_BUDGET).await;
        if !current.dbus {
            return Err(
                "desktop D-Bus: managed process is alive but not responding; inspect dbus.log"
                    .into(),
            );
        }
        if let Some(path) = env_file {
            export_environment(path, &bus)?;
        }
        return Ok(current);
    }
    let socket = state.join("dbus.sock");
    if socket.exists() {
        // A successful connect also protects listeners which do not answer D-Bus probes.
        match tokio::time::timeout(PROBE_BUDGET, tokio::net::UnixStream::connect(&socket)).await {
            Ok(Err(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
                ) => {}
            _ => {
                return Err(
                    "desktop D-Bus: unmanaged listener occupies the desktop socket; left untouched"
                        .into(),
                );
            }
        }
        remove(&socket)?;
    }
    remove(&state.join("dbus.pid"))?;
    let current = start(state, &bus).await?;
    if let Some(path) = env_file {
        export_environment(path, &bus)?;
    }
    Ok(current)
}

#[cfg(target_os = "linux")]
pub(crate) async fn stop(state: &Path) -> Result {
    let _lock = locked(state).await?;
    let bus = address(state);
    if let Some(pid) = pid_from(state)?.filter(|pid| alive(*pid)) {
        if !owned(pid, &bus) {
            return Err(format!(
                "desktop D-Bus: dbus.pid names unrelated PID {pid}; left untouched"
            )
            .into());
        }
        stop_process(pid, &bus).await?;
        remove(&state.join("dbus.sock"))?;
    }
    remove(&state.join("dbus.pid"))
}

#[cfg(not(target_os = "linux"))]
pub(crate) async fn ensure(_: &Path, _: Option<&Path>) -> Result<Status> {
    Err("desktop D-Bus: lifecycle management is supported only on Linux".into())
}
#[cfg(not(target_os = "linux"))]
pub(crate) async fn stop(_: &Path) -> Result {
    Err("desktop D-Bus: lifecycle management is supported only on Linux".into())
}

pub async fn run(args: &[OsString]) -> Result<bool> {
    let Some(action) = args
        .first()
        .and_then(|arg| arg.to_str())
        .filter(|action| matches!(*action, "ensure" | "status" | "stop"))
    else {
        return Err("usage: study-dev dbus {ensure|status|stop} [--state PATH] [--env-file PATH] [--address-only]".into());
    };
    let mut state = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/desktop");
    let mut env_file = None;
    let mut address_only = false;
    let mut rest = args[1..].iter();
    while let Some(flag) = rest.next() {
        if flag == "--address-only" {
            address_only = true;
        } else if flag == "--state" {
            state = PathBuf::from(rest.next().ok_or("--state requires PATH")?);
        } else if flag == "--env-file" {
            env_file = Some(PathBuf::from(
                rest.next().ok_or("--env-file requires PATH")?,
            ));
        } else {
            return Err(format!("unknown dbus argument: {}", flag.to_string_lossy()).into());
        }
    }
    if action == "stop" {
        stop(&state).await?;
        return Ok(true);
    }
    let current = if action == "ensure" {
        ensure(&state, env_file.as_deref()).await?
    } else {
        status(&state, PROBE_BUDGET).await
    };
    if address_only {
        println!("{}", current.address);
    } else {
        println!("{}", serde_json::to_string(&current)?);
    }
    Ok(current.dbus)
}
#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lifecycle_reuses_and_preserves_environment() {
        let folder = tempfile::tempdir().unwrap();
        let state = folder.path().join("space ' and %");
        fs::create_dir(&state).unwrap();
        let env = state.join("desktop.env");
        fs::write(
            &env,
            "export WAYLAND_DISPLAY=wayland-1\nexport DBUS_SESSION_BUS_ADDRESS=old\n",
        )
        .unwrap();
        let first = ensure(&state, Some(&env)).await.unwrap();
        let second = ensure(&state, Some(&env)).await.unwrap();
        assert!(first.dbus && first.owned);
        assert_eq!(first.pid, second.pid);
        assert!(first.address.contains("%20%27%20and%20%25"));
        let source = fs::read_to_string(env).unwrap();
        assert!(source.contains("export WAYLAND_DISPLAY=wayland-1\n"));
        assert_eq!(
            source.matches("export DBUS_SESSION_BUS_ADDRESS=").count(),
            1
        );
        assert!(
            shlex::split(&source)
                .unwrap()
                .contains(&format!("DBUS_SESSION_BUS_ADDRESS={}", first.address))
        );
        assert!(!status(&state, Duration::ZERO).await.dbus);
        stop(&state).await.unwrap();
        assert!(!status(&state, Duration::from_secs(1)).await.owned);
        assert!(!state.join("dbus.pid").exists());
    }

    #[tokio::test]
    async fn foreign_and_malformed_pids_are_untouched() {
        let folder = tempfile::tempdir().unwrap();
        for pid in [std::process::id().to_string(), "0".into(), "garbage".into()] {
            fs::write(folder.path().join("dbus.pid"), &pid).unwrap();
            assert!(ensure(folder.path(), None).await.is_err());
            assert!(stop(folder.path()).await.is_err());
            assert_eq!(
                fs::read_to_string(folder.path().join("dbus.pid")).unwrap(),
                pid
            );
        }
    }

    #[tokio::test]
    async fn stale_pid_is_replaced_and_concurrent_ensure_serializes() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("dbus.pid"), "4294967295\n").unwrap();
        let (first, second) =
            tokio::join!(ensure(folder.path(), None), ensure(folder.path(), None));
        let first = first.unwrap();
        let second = second.unwrap();
        assert!(first.dbus && second.dbus);
        assert_eq!(first.pid, second.pid);
        stop(folder.path()).await.unwrap();
    }

    #[tokio::test]
    async fn unmanaged_listener_is_never_removed() {
        let folder = tempfile::tempdir().unwrap();
        let socket = folder.path().join("dbus.sock");
        let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        assert!(ensure(folder.path(), None).await.is_err());
        stop(folder.path()).await.unwrap();
        assert!(socket.exists());
        drop(listener);
    }

    #[tokio::test]
    async fn live_bus_without_pid_is_never_adopted_or_stopped() {
        let folder = tempfile::tempdir().unwrap();
        let first = ensure(folder.path(), None).await.unwrap();
        fs::remove_file(folder.path().join("dbus.pid")).unwrap();
        assert!(ensure(folder.path(), None).await.is_err());
        stop(folder.path()).await.unwrap();
        assert!(probe(&first.address, Duration::from_secs(1)).await);
        fs::write(
            folder.path().join("dbus.pid"),
            first.pid.unwrap().to_string(),
        )
        .unwrap();
        stop(folder.path()).await.unwrap();
    }

    #[tokio::test]
    async fn daemon_closes_inherited_caller_descriptors() {
        use nix::fcntl::{FcntlArg, FdFlag, fcntl};
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("caller.lock");
        let file = fs::File::create(&path).unwrap();
        file.lock().unwrap();
        fcntl(&file, FcntlArg::F_SETFD(FdFlag::empty())).unwrap();
        let current = ensure(folder.path(), None).await.unwrap();
        fcntl(&file, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC)).unwrap();
        let inherited = fs::read_dir(format!("/proc/{}/fd", current.pid.unwrap()))
            .unwrap()
            .any(|entry| {
                entry
                    .ok()
                    .and_then(|entry| fs::read_link(entry.path()).ok())
                    .is_some_and(|target| target == path)
            });
        stop(folder.path()).await.unwrap();
        assert!(!inherited, "daemon retained an inherited caller lock");
    }

    #[tokio::test]
    async fn cancelled_start_does_not_leave_a_daemon_or_pid() {
        let folder = tempfile::tempdir().unwrap();
        let pid = tokio::select! {
            biased;
            result = ensure(folder.path(), None) => panic!("ensure finished before cancellation: {}", result.is_ok()),
            pid = async {
                loop {
                    if let Ok(Some(pid)) = pid_from(folder.path()) { break pid; }
                    tokio::task::yield_now().await;
                }
            } => pid,
        };
        sleep(Duration::from_millis(100)).await;
        let leaked = alive(pid);
        if leaked {
            stop(folder.path()).await.unwrap();
        }
        assert!(!leaked, "cancelled startup leaked its daemon");
        assert!(!folder.path().join("dbus.pid").exists());
    }

    #[tokio::test]
    async fn failed_daemon_start_cleans_pid_state() {
        let folder = tempfile::tempdir().unwrap();
        let state = folder.path().join("x".repeat(120));
        assert!(ensure(&state, None).await.is_err());
        assert!(!state.join("dbus.pid").exists());
        assert!(!state.join("dbus.sock").exists());
    }

    #[tokio::test]
    async fn probe_and_lock_have_deadlines() {
        let folder = tempfile::tempdir().unwrap();
        let _listener =
            std::os::unix::net::UnixListener::bind(folder.path().join("dbus.sock")).unwrap();
        let started = Instant::now();
        assert!(!probe(&address(folder.path()), Duration::from_millis(40)).await);
        assert!(started.elapsed() < Duration::from_secs(1));
        let _lock = locked(folder.path()).await.unwrap();
        let started = Instant::now();
        assert!(locked(folder.path()).await.is_err());
        assert!(started.elapsed() >= START_BUDGET);
        assert!(started.elapsed() < START_BUDGET + Duration::from_secs(1));
    }

    #[tokio::test]
    async fn daemon_for_another_address_is_foreign() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let current = ensure(first.path(), None).await.unwrap();
        fs::write(
            second.path().join("dbus.pid"),
            current.pid.unwrap().to_string(),
        )
        .unwrap();
        assert!(!status(second.path(), PROBE_BUDGET).await.owned);
        assert!(ensure(second.path(), None).await.is_err());
        assert!(stop(second.path()).await.is_err());
        assert!(status(first.path(), PROBE_BUDGET).await.dbus);
        stop(first.path()).await.unwrap();
    }

    #[test]
    fn missing_relative_state_has_absolute_normalized_address() {
        let expected = address(
            &std::env::current_dir()
                .unwrap()
                .join("target/no-such-state"),
        );
        assert_eq!(
            address(Path::new("target/no-such-state/../no-such-state")),
            expected
        );
    }
}
