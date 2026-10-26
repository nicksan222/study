//! Real process checks for the private bus's command-line lifetime boundary.
#![cfg(target_os = "linux")]
use std::{
    fs::{File, OpenOptions},
    process::{Command, Output},
};

const TOOL: &str = env!("CARGO_BIN_EXE_study-dev");
struct Bus(tempfile::TempDir);
impl Bus {
    fn command(&self, action: &str) -> Output {
        Command::new(TOOL)
            .args(["dbus", action, "--state"])
            .arg(self.0.path())
            .output()
            .unwrap()
    }
}
impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.command("stop");
    }
}

#[test]
fn daemon_does_not_retain_the_callers_desktop_lifetime_lock() {
    let bus = Bus(tempfile::tempdir().unwrap());
    let lock = bus.0.path().join("caller.lock");
    let result = Command::new("bash")
        .args([
            "-euo",
            "pipefail",
            "-c",
            "exec 9> \"$1\"; flock 9; \"$2\" dbus ensure --state \"$3\"",
            "bus-test",
        ])
        .arg(&lock)
        .arg(TOOL)
        .arg(bus.0.path())
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let file = OpenOptions::new().append(true).open(&lock).unwrap();
    assert!(
        file.try_lock().is_ok(),
        "background daemon retained the caller's lock"
    );
    assert!(bus.command("status").status.success());
    assert!(bus.command("stop").status.success());
    let private_lock = File::open(bus.0.path().join("dbus.lock")).unwrap();
    assert!(
        private_lock.try_lock().is_ok(),
        "daemon retained the manager's own lock"
    );
}
