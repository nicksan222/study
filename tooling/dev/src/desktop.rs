//! Read-only desktop inspection with one deadline shared by every IPC probe.
#![allow(clippy::print_stdout)] // JSON and logical geometry are the command's output.

use std::{collections::BTreeMap, ffi::OsString, fs, path::Path, process::Output, time::Duration};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    process::Command,
    time::{Instant, timeout},
};

use crate::Result;

#[derive(Clone, Copy, Deserialize)]
struct Rect {
    x: i64,
    y: i64,
    width: u32,
    height: u32,
}
impl Rect {
    fn geometry(self) -> String {
        format!("{},{} {}x{}", self.x, self.y, self.width, self.height)
    }
}

#[derive(Deserialize)]
struct Node {
    app_id: Option<String>,
    rect: Option<Rect>,
    #[serde(default)]
    nodes: Vec<Node>,
    #[serde(default)]
    floating_nodes: Vec<Node>,
}

fn window(tree: &Value) -> Result<Option<Rect>> {
    let tree: Node = serde_json::from_value(tree.clone())?;
    let mut pending = vec![&tree];
    while let Some(node) = pending.pop() {
        if node.app_id.as_deref() == Some("study") {
            return node
                .rect
                .map(Some)
                .ok_or_else(|| "Study window has no geometry".into());
        }
        pending.extend(&node.nodes);
        pending.extend(&node.floating_nodes);
    }
    Ok(None)
}

fn environment(path: &Path) -> Result<BTreeMap<String, String>> {
    if !path.is_file() {
        return Err("managed desktop environment is missing; run just desktop".into());
    }
    let source = fs::read_to_string(path)?;
    let words = shlex::split(&source).ok_or("desktop.env has invalid shell quoting")?;
    let values: BTreeMap<_, _> = words
        .into_iter()
        .filter_map(|word| {
            word.split_once('=')
                .map(|(key, value)| (key.to_owned(), value.to_owned()))
        })
        .collect();
    if values.get("SWAYSOCK").is_none_or(String::is_empty) {
        return Err("managed desktop environment has no SWAYSOCK; run just desktop".into());
    }
    Ok(values)
}

async fn output(command: &mut Command, budget: Duration) -> Result<Output> {
    if budget.is_zero() {
        return Err("desktop IPC timed out".into());
    }
    timeout(budget, command.kill_on_drop(true).output())
        .await
        .map_err(|_| "desktop IPC timed out")?
        .map_err(Into::into)
}

async fn sway(
    kind: &str,
    environment: &BTreeMap<String, String>,
    budget: Duration,
) -> Result<Value> {
    let result = output(
        Command::new("swaymsg").args(["-t", kind]).envs(environment),
        budget,
    )
    .await?;
    if !result.status.success() {
        return Err(format!(
            "swaymsg {kind}: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        )
        .into());
    }
    Ok(serde_json::from_slice(&result.stdout)?)
}

fn bus_address(state: &Path) -> String {
    let socket = state
        .canonicalize()
        .unwrap_or_else(|_| state.to_owned())
        .join("dbus.sock");
    let mut address = String::from("unix:path=");
    for &byte in socket.as_os_str().as_encoded_bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
            address.push(char::from(byte));
        } else {
            address.push_str(&format!("%{byte:02X}"));
        }
    }
    address
}

fn owned_bus(state: &Path, address: &str) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let Some(pid) = fs::read_to_string(state.join("dbus.pid"))
            .ok()
            .and_then(|pid| pid.trim().parse::<u32>().ok())
            .filter(|pid| *pid > 1)
        else {
            return false;
        };
        let process = Path::new("/proc").join(pid.to_string());
        let Ok(metadata) = fs::metadata(&process) else {
            return false;
        };
        let Ok(ours) = fs::metadata("/proc/self") else {
            return false;
        };
        if metadata.uid() != ours.uid() {
            return false;
        }
        let Ok(stat) = fs::read_to_string(process.join("stat")) else {
            return false;
        };
        let Some(state) = stat
            .rsplit_once(") ")
            .and_then(|(_, fields)| fields.split_whitespace().next())
        else {
            return false;
        };
        if matches!(state, "Z" | "X") {
            return false;
        }
        let Ok(command) = fs::read(process.join("cmdline")) else {
            return false;
        };
        let args: Vec<_> = command.split(|byte| *byte == 0).collect();
        args.iter()
            .any(|arg| *arg == b"dbus-daemon" || arg.ends_with(b"/dbus-daemon"))
            && args.contains(&format!("--address={address}").as_bytes())
    }
    #[cfg(not(unix))]
    {
        let _ = (state, address);
        false
    }
}

async fn status(root: &Path, budget: Duration) -> Result<Value> {
    let deadline = Instant::now()
        .checked_add(budget)
        .ok_or("desktop timeout is too large")?;
    let env_file = root.join("target/desktop.env");
    let state = root.join("target/desktop");
    let address = bus_address(&state);
    let mut result = json!({"desktop":env_file.is_file(), "window":false, "log":state.join("app.log"), "dbus":false, "dbusAddress":address});
    if env_file.is_file() && !budget.is_zero() {
        let probe = async {
            let env = environment(&env_file)?;
            window(
                &sway(
                    "get_tree",
                    &env,
                    deadline.saturating_duration_since(Instant::now()),
                )
                .await?,
            )
        }
        .await;
        match probe {
            Ok(window) => result["window"] = json!(window.is_some()),
            Err(error) => result["diagnostic"] = json!(error.to_string()),
        }
    }
    if owned_bus(&state, &address) {
        let probe = output(
            Command::new("dbus-send")
                .args([
                    "--session",
                    "--print-reply",
                    "--dest=org.freedesktop.DBus",
                    "/org/freedesktop/DBus",
                    "org.freedesktop.DBus.ListNames",
                ])
                .env("DBUS_SESSION_BUS_ADDRESS", &address),
            deadline.saturating_duration_since(Instant::now()),
        )
        .await;
        result["dbus"] = json!(probe.is_ok_and(|output| output.status.success()));
    }
    if let Some(pid) = fs::read_to_string(state.join("app.pid"))
        .ok()
        .and_then(|pid| pid.trim().parse::<u32>().ok())
        .filter(|pid| *pid > 1)
        && Path::new("/proc").join(pid.to_string()).is_dir()
    {
        result["pid"] = json!(pid);
    }
    Ok(result)
}

#[derive(Clone, Copy)]
enum Query {
    Exists,
    Geometry,
    Position,
    Scale,
}
enum Action {
    Query(Query),
    Status,
    Wait,
}

fn arguments(args: &[OsString]) -> Result<(Action, Duration)> {
    let usage = "usage: study-dev desktop {status|wait|query exists|geometry|position|scale} [--timeout SECONDS]";
    let (action, rest) = match args {
        [command, rest @ ..] if command == "status" => (Action::Status, rest),
        [command, rest @ ..] if command == "wait" => (Action::Wait, rest),
        [command, value, rest @ ..] if command == "query" => {
            let query = match value.to_str() {
                Some("exists") => Query::Exists,
                Some("geometry") => Query::Geometry,
                Some("position") => Query::Position,
                Some("scale") => Query::Scale,
                _ => return Err(usage.into()),
            };
            (Action::Query(query), rest)
        }
        _ => return Err(usage.into()),
    };
    let default = if matches!(action, Action::Wait) {
        120.0
    } else {
        2.0
    };
    let seconds = match rest {
        [] => default,
        [flag, seconds] if flag == "--timeout" => seconds.to_str().ok_or(usage)?.parse()?,
        _ => return Err(usage.into()),
    };
    let budget = Duration::try_from_secs_f64(seconds)
        .map_err(|_| "timeout must be a nonnegative finite number")?;
    Ok((action, budget))
}

pub async fn run(args: &[OsString]) -> Result<bool> {
    let (action, budget) = arguments(args)?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    if let Action::Query(query) = action {
        let env = environment(&root.join("target/desktop.env"))?;
        if matches!(query, Query::Scale) {
            #[derive(Deserialize)]
            struct Monitor {
                name: String,
                scale: Option<f64>,
            }
            let outputs: Vec<Monitor> =
                serde_json::from_value(sway("get_outputs", &env, budget).await?)?;
            let scale = outputs
                .into_iter()
                .find(|output| output.name == "HEADLESS-1")
                .and_then(|output| output.scale)
                .filter(|scale| scale.is_finite() && *scale > 0.0)
                .ok_or("the managed HEADLESS-1 output is missing or has invalid scale")?;
            println!("{scale}");
            return Ok(true);
        }
        let rect = window(&sway("get_tree", &env, budget).await?)?;
        if matches!(query, Query::Exists) {
            return Ok(rect.is_some());
        }
        let rect = rect.ok_or("Study has no window; run just desktop-run first")?;
        if matches!(query, Query::Position) {
            println!("{} {}", rect.x, rect.y);
        } else {
            println!("{}", rect.geometry());
        }
        return Ok(true);
    }
    let deadline = Instant::now()
        .checked_add(budget)
        .ok_or("desktop timeout is too large")?;
    loop {
        let current = status(
            &root,
            deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_secs(2)),
        )
        .await?;
        let ready = current["window"] == true;
        if matches!(action, Action::Status) || ready || Instant::now() >= deadline {
            println!("{}", serde_json::to_string(&current)?);
            return Ok(matches!(action, Action::Status) || ready);
        }
        tokio::time::sleep(
            deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(250)),
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn tiled_and_floating_windows_use_logical_coordinates() {
        for branch in ["nodes", "floating_nodes"] {
            let tree = json!({"nodes":[{branch:[{"app_id":"study","rect":{"x":-40,"y":10,"width":1200,"height":800}}]}]});
            assert_eq!(
                window(&tree).unwrap().map(Rect::geometry).as_deref(),
                Some("-40,10 1200x800")
            );
        }
        assert!(
            window(&json!({"app_id":"chromium","nodes":[]}))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn missing_managed_environment_or_socket_never_falls_back_to_the_current_session() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("desktop.env");
        assert!(environment(&path).is_err());
        for source in ["export WAYLAND_DISPLAY=wayland-1\n", "export SWAYSOCK=''\n"] {
            fs::write(&path, source).unwrap();
            assert!(environment(&path).is_err());
        }
    }

    #[test]
    fn exported_values_are_parsed_without_executing_shell_code() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("desktop.env");
        fs::write(&path, "export SWAYSOCK='/tmp/a b.sock' WAYLAND_DISPLAY=wayland-1\nexport MARKER='$(touch /tmp/must-not-run)'\n").unwrap();
        let values = environment(&path).unwrap();
        assert_eq!(values["SWAYSOCK"], "/tmp/a b.sock");
        assert_eq!(values["MARKER"], "$(touch /tmp/must-not-run)");
        fs::write(&path, "export SWAYSOCK='unterminated").unwrap();
        assert!(environment(&path).is_err());
    }

    #[test]
    fn timeouts_reject_invalid_values() {
        for value in ["-1", "NaN", "inf", "not-a-number"] {
            let args: Vec<_> = ["wait", "--timeout", value]
                .into_iter()
                .map(OsString::from)
                .collect();
            assert!(arguments(&args).is_err());
        }
        let state = Path::new("/tmp/private bus é");
        assert_eq!(
            bus_address(state),
            "unix:path=/tmp/private%20bus%20%C3%A9/dbus.sock"
        );
    }

    #[test]
    fn malformed_window_geometry_is_not_silently_replaced_with_zeroes() {
        assert!(window(&json!({"app_id":"study","rect":{"x":1}})).is_err());
    }

    #[tokio::test]
    async fn absent_desktop_is_reported_without_contacting_the_current_session() {
        let directory = tempfile::tempdir().unwrap();
        let value = status(directory.path(), Duration::from_millis(100))
            .await
            .unwrap();
        assert_eq!(value["desktop"], false);
        assert_eq!(value["window"], false);
        assert_eq!(value["dbus"], false);
        assert!(
            value["log"]
                .as_str()
                .unwrap()
                .ends_with("target/desktop/app.log")
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn private_stalled_sway_socket_cannot_exceed_the_status_deadline() {
        use std::os::unix::net::UnixListener;
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("target")).unwrap();
        let state = directory.path().join("target/desktop");
        fs::create_dir(&state).unwrap();
        struct Daemon(std::process::Child);
        impl Drop for Daemon {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let daemon = Daemon(
            std::process::Command::new("dbus-daemon")
                .args(["--session", "--nofork", "--nopidfile"])
                .arg(format!("--address={}", bus_address(&state)))
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap(),
        );
        fs::write(state.join("dbus.pid"), daemon.0.id().to_string()).unwrap();
        assert!(
            std::process::Command::new("kill")
                .arg("-STOP")
                .arg(daemon.0.id().to_string())
                .status()
                .unwrap()
                .success()
        );
        assert!(owned_bus(&state, &bus_address(&state)));

        let socket = directory.path().join("sway.sock");
        let _listener = UnixListener::bind(&socket).unwrap();
        fs::write(
            directory.path().join("target/desktop.env"),
            format!("export SWAYSOCK='{}'\n", socket.display()),
        )
        .unwrap();
        let before = std::time::Instant::now();
        let value = status(directory.path(), Duration::from_millis(150))
            .await
            .unwrap();
        assert!(before.elapsed() < Duration::from_millis(800));
        assert_eq!(value["window"], false);
        assert!(value["diagnostic"].as_str().unwrap().contains("timed out"));
    }
}
