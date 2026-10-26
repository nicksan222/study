//! Nested desktop commands reuse a prepared binary without taking Cargo's build lock.
#![cfg(target_os = "linux")]
use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command};

const TOOL: &str = env!("CARGO_BIN_EXE_study-dev");

#[test]
fn inherited_tool_never_invokes_cargo_even_if_the_binary_is_missing() {
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let cargo = bin.join("cargo");
    let marker = root.path().join("cargo-called");
    fs::write(
        &cargo,
        "#!/usr/bin/env bash\ntouch \"$TEST_CARGO_CALLED\"\nexit 77\n",
    )
    .unwrap();
    fs::set_permissions(&cargo, fs::Permissions::from_mode(0o755)).unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.devcontainer/desktop/tool.sh");
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    for (binary, success) in [
        (Path::new(TOOL).to_owned(), true),
        (root.path().join("missing"), false),
    ] {
        let result = Command::new("bash")
            .args([
                "-euo",
                "pipefail",
                "-c",
                ". \"$1\"; test \"$study_dev\" = \"$STUDY_DEV_TOOL\"",
                "bootstrap-test",
            ])
            .arg(&script)
            .env("PATH", &path)
            .env("TEST_CARGO_CALLED", &marker)
            .env("STUDY_DEV_TOOL", binary)
            .output()
            .unwrap();
        assert_eq!(
            result.status.success(),
            success,
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(
            !marker.exists(),
            "nested bootstrap attempted to acquire Cargo's build lock"
        );
    }
}

#[test]
fn prepared_binary_survives_cache_cleanup_nested_startup_and_failed_rebuild() {
    let root = tempfile::tempdir().unwrap();
    let scripts = root.path().join(".devcontainer/desktop");
    fs::create_dir_all(&scripts).unwrap();
    let script = scripts.join("tool.sh");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.devcontainer/desktop/tool.sh"),
        &script,
    )
    .unwrap();
    let artifact = root.path().join("target/devcontainer/debug/study-dev");
    fs::create_dir_all(artifact.parent().unwrap()).unwrap();
    fs::copy(TOOL, &artifact).unwrap();
    let metadata = root.path().join("artifact.json");
    fs::write(&metadata, serde_json::to_vec(&serde_json::json!({"reason":"compiler-artifact","target":{"name":"study-dev"},"executable":artifact})).unwrap()).unwrap();
    let marker = root.path().join("cargo-calls");
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let cargo = bin.join("cargo");
    fs::write(&cargo, "#!/usr/bin/env bash\nprintf 'called\\n' >> \"$TEST_CARGO_CALLED\"\ncat \"$TEST_CARGO_METADATA\"\n").unwrap();
    fs::set_permissions(&cargo, fs::Permissions::from_mode(0o755)).unwrap();
    let result = Command::new("bash").args(["-euo", "pipefail", "-c",
        r#"
. "$1"
prepared=$study_dev
rm -- "$TEST_ARTIFACT"
STUDY_DEV_TOOL="$prepared" bash -euo pipefail -c '. "$1"; test -f "$study_dev" && test -x "$study_dev"' nested "$1"
if env -u STUDY_DEV_TOOL bash -euo pipefail -c '. "$1"' failed-rebuild "$1"; then exit 1; fi
test -f "$prepared" && test -x "$prepared"
"#, "bootstrap-test"])
        .arg(&script).env_remove("STUDY_DEV_TOOL")
        .env("PATH", format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()))
        .env("TEST_CARGO_CALLED", &marker).env("TEST_CARGO_METADATA", &metadata).env("TEST_ARTIFACT", &artifact)
        .output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(fs::read_to_string(marker).unwrap().lines().count(), 2);
    assert!(root.path().join("target/desktop/study-dev").is_file());
}
