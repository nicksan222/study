//! Exit-wait CLI accepts signed targets without starting or signaling processes.
#![cfg(target_os = "linux")]
use std::process::Command;

#[test]
fn absent_pid_and_group_complete_silently_while_unsafe_identifiers_fail() {
    let tool = env!("CARGO_BIN_EXE_study-dev");
    for target in ["2147483647", "-2147483647"] {
        let result = Command::new(tool)
            .args(["wait-exit", target])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(result.stdout.is_empty());
    }
    for target in ["0", "1", "-1", "-2147483648", "garbage"] {
        assert!(
            !Command::new(tool)
                .args(["wait-exit", target])
                .output()
                .unwrap()
                .status
                .success()
        );
    }
}
