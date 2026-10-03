//! The private desktop the demo runs on: a headless sway of its own, the app, the screen
//! recorder, and the few ways to look at the screen and to press keys and buttons.
//!
//! It copies the shape of `.devcontainer/desktop` (one fixed output, no bar, no borders, a
//! virtual pointer plugged in by `seat.py`) but shares nothing with it, so recording never
//! disturbs `just desktop` and the shared desktop never disturbs a recording.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

use study_core::{Context as _, Error, Result};

/// The output's size; the GIF shows exactly these pixels at scale 1.
pub const WIDTH: u32 = 1920;
pub const HEIGHT: u32 = 1080;

/// The app's window ID, a copy of the one in `apps/desktop/src/app/desktop.rs`: this crate
/// cannot depend on the binary. If it changes there, the wait for the window times out here.
const APP_ID: &str = "io.github.nicksan222.Study";

/// Time for the app to draw before the welcome tour's Skip is pressed, and for the shell to
/// settle after it.
const BEFORE_SKIP: Duration = Duration::from_secs(1);
const AFTER_SKIP: Duration = Duration::from_secs(2);
/// Time for the recorder to write its first frame before the tour starts.
pub const FIRST_FRAME: Duration = Duration::from_millis(800);
/// How long a button is held down.
pub const PRESS_MS: u64 = 60;

/// Where the welcome tour's "Skip" sits, and the rail's first row once the shell shows.
const SKIP: Region = Region {
    x: WIDTH - 75,
    y: 10,
    width: 70,
    height: 24,
};
const RAIL: Region = Region {
    x: RAIL_X,
    y: RAIL_FIRST - 14,
    width: RAIL_WIDTH,
    height: 28,
};
/// The rail on the left: where it sits, how wide it is, and the middle of its first row and
/// the distance to the next.
pub const RAIL_X: u32 = 8;
pub const RAIL_WIDTH: u32 = 244;
pub const RAIL_FIRST: u32 = 70;
pub const RAIL_STEP: u32 = 34;
/// Where the pointer rests when the recording starts and ends: on the welcome tour's "Skip".
pub const START: (u32, u32) = (WIDTH - 40, 22);
const SKIP_CLICK: (u32, u32) = START;

/// A running sway with its environment. Stops sway when dropped.
pub struct Desktop {
    sway: Child,
    /// The virtual pointer and the keyboard holder, which live as long as sway.
    helpers: Vec<Guard>,
    runtime_dir: String,
    display: String,
    socket: String,
}

/// A process that is stopped when this is dropped.
pub struct Guard(Child);

impl Guard {
    /// How the process ended, once it has.
    pub fn ended(&mut self) -> Option<ExitStatus> {
        self.0.try_wait().ok().flatten()
    }

    /// Fails if the process has ended, pointing at its log in `work`.
    pub fn check_running(&mut self, work: &Path) -> Result<()> {
        match self.ended() {
            Some(status) => Err(Error::msg(format!(
                "the app exited ({status}); see {}",
                work.join("app.log").display()
            ))),
            None => Ok(()),
        }
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        stop(&mut self.0);
    }
}

impl Drop for Desktop {
    fn drop(&mut self) {
        // The helpers go first: they talk to sway.
        self.helpers.clear();
        stop(&mut self.sway);
    }
}

/// Sends the signal `name` (`TERM`, `INT`) to `child`.
fn signal(child: &Child, name: &str) -> Result<()> {
    let status = Command::new("kill")
        .args([&format!("-{name}"), &child.id().to_string()])
        .stderr(Stdio::null())
        .status()
        .context("cannot run kill")?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::msg(format!("cannot send {name} to {}", child.id())))
    }
}

/// Asks `child` to end, and kills it if it has not within a few seconds.
fn stop(child: &mut Child) {
    // An exited child is reaped; its PID may already belong to another process.
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    signal(child, "TERM").ok();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    child.kill().ok();
    child.wait().ok();
}

/// A rectangle of the screen, in pixels.
#[derive(Clone, Copy)]
struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl Desktop {
    /// Starts sway with a runtime directory and configuration under `work`.
    pub fn start(repo: &Path, work: &Path) -> Result<Self> {
        let runtime = work.join("rt");
        fs::remove_dir_all(&runtime).ok();
        fs::create_dir_all(&runtime)?;
        set_private(&runtime)?;
        let config = work.join("sway.config");
        fs::write(&config, sway_config())?;

        let log = fs::File::create(work.join("sway.log"))?;
        let sway = Command::new("sway")
            .arg("-c")
            .arg(&config)
            .env("XDG_RUNTIME_DIR", &runtime)
            .env("WLR_BACKENDS", "headless")
            .env("WLR_LIBINPUT_NO_DEVICES", "1")
            .env("WLR_RENDERER", "pixman")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("DISPLAY")
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .spawn()
            .context("cannot start sway")?;
        let mut desktop = Self {
            sway,
            helpers: Vec::new(),
            runtime_dir: runtime.to_string_lossy().into_owned(),
            display: String::new(),
            socket: String::new(),
        };
        // sway names its sockets after the runtime directory it was given and its own PID.
        let pid = desktop.sway.id();
        wait(Duration::from_secs(20), "sway to start", || {
            if let Some(status) = desktop.sway.try_wait()? {
                return Err(Error::msg(format!(
                    "sway exited ({status}); see {}",
                    work.join("sway.log").display()
                )));
            }
            Ok(discover(&runtime, pid).map(|(display, socket)| {
                (desktop.display, desktop.socket) = (display, socket);
            }))
        })?;
        // Plugged in once sway is up, and stopped with it: sway's own `exec` would detach them.
        let seat = repo.join(".devcontainer/desktop/seat.py");
        let pointer = desktop.command("python3").arg(seat).spawn()?;
        desktop.helpers.push(Guard(pointer));
        let keyboard = desktop
            .command("wtype")
            .args(["-s", "2000000000"])
            .spawn()?;
        desktop.helpers.push(Guard(keyboard));
        Ok(desktop)
    }

    /// Starts the app on this desktop.
    pub fn launch(&self, app: &Path, work: &Path) -> Result<Guard> {
        let log = fs::File::create(work.join("app.log"))?;
        let child = self
            .command(app)
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .spawn()
            .context("cannot start the app")?;
        Ok(Guard(child))
    }

    /// A command that talks to this desktop and no other.
    pub fn command(&self, program: impl AsRef<std::ffi::OsStr>) -> Command {
        let mut command = Command::new(program);
        command
            .env("XDG_RUNTIME_DIR", &self.runtime_dir)
            .env("WAYLAND_DISPLAY", &self.display)
            .env("SWAYSOCK", &self.socket)
            .env_remove("DISPLAY");
        command
    }

    /// Runs `program` to completion and fails if it does.
    pub fn run(&self, program: &str, args: &[&str]) -> Result<()> {
        let status = self
            .command(program)
            .args(args)
            .stdout(Stdio::null())
            .status()
            .with_context(|| format!("cannot run {program}"))?;
        if !status.success() {
            return Err(Error::msg(format!("{program} {args:?} failed: {status}")));
        }
        Ok(())
    }

    fn swaymsg(&self, args: &[&str]) -> Result<String> {
        let output = self
            .command("swaymsg")
            .args(args)
            .output()
            .context("cannot run swaymsg")?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Whether the app has a window.
    fn has_window(&self) -> bool {
        self.swaymsg(&["-t", "get_tree"])
            .is_ok_and(|tree| tree.contains(APP_ID))
    }

    /// Whether any pixel in `region` is bright: text or an icon is drawn there.
    fn is_lit(&self, region: Region) -> bool {
        let geometry = format!(
            "{},{} {}x{}",
            region.x, region.y, region.width, region.height
        );
        self.command("grim")
            .args(["-t", "ppm", "-g", &geometry, "-"])
            .output()
            .is_ok_and(|output| output.status.success() && any_lit(&output.stdout))
    }

    /// Waits for the window and the first-launch measurement, skips the welcome tour in the
    /// app itself, and lets it settle. None of this is recorded. Fails at once if the app
    /// ends meanwhile, pointing at its log in `work`.
    pub fn wait_until_ready(&self, app: &mut Guard, work: &Path) -> Result<()> {
        wait(Duration::from_secs(120), "the app's window", || {
            app.check_running(work)?;
            Ok(self.has_window().then_some(()))
        })?;
        // The measurement screen has no "Skip"; the tour that follows it does.
        wait(Duration::from_secs(600), "the welcome tour", || {
            app.check_running(work)?;
            Ok(self.is_lit(SKIP).then_some(()))
        })?;
        thread::sleep(BEFORE_SKIP);
        self.click(SKIP_CLICK.0, SKIP_CLICK.1)?;
        wait(Duration::from_secs(60), "the app's shell", || {
            app.check_running(work)?;
            Ok(self.is_lit(RAIL).then_some(()))
        })?;
        thread::sleep(AFTER_SKIP);
        Ok(())
    }

    /// Moves the pointer to a screen position without any glide.
    pub fn warp(&self, x: u32, y: u32) -> Result<()> {
        self.swaymsg(&["seat", "-", "cursor", "set", &x.to_string(), &y.to_string()])
            .map(drop)
    }

    /// Presses and releases the left button where the pointer is.
    pub fn press(&self) -> Result<()> {
        self.swaymsg(&["seat", "-", "cursor", "press", "button1"])?;
        thread::sleep(Duration::from_millis(PRESS_MS));
        self.swaymsg(&["seat", "-", "cursor", "release", "button1"])
            .map(drop)
    }

    fn click(&self, x: u32, y: u32) -> Result<()> {
        self.warp(x, y)?;
        thread::sleep(Duration::from_millis(200));
        self.press()
    }

    /// Starts recording the output into `path`; the recorder's messages go to `log`.
    pub fn record(&self, path: &Path, log: &Path) -> Result<Recording> {
        fs::remove_file(path).ok();
        let messages = fs::File::create(log)?;
        let child = self
            .command("wf-recorder")
            .args(["-o", "HEADLESS-1", "-f"])
            .arg(path)
            .stdin(Stdio::null())
            .stdout(messages.try_clone()?)
            .stderr(messages)
            .spawn()
            .context("cannot start wf-recorder")?;
        Ok(Recording {
            process: Guard(child),
            log: log.to_owned(),
        })
    }
}

/// A running screen recording. Dropping it stops the recorder; [`Recording::stop`] ends it
/// cleanly so the file is complete.
pub struct Recording {
    process: Guard,
    log: PathBuf,
}

impl Recording {
    /// Fails if the recorder has already ended, which it only does when it cannot record.
    pub fn check_running(&mut self) -> Result<()> {
        match self.process.ended() {
            Some(status) => Err(Error::msg(format!(
                "wf-recorder exited ({status}); see {}",
                self.log.display()
            ))),
            None => Ok(()),
        }
    }

    /// Asks the recorder to finish the file and waits for it. A still screen sends the
    /// recorder no frame to notice the request on, so the pointer is nudged until it ends,
    /// and comes back to where the recording began.
    pub fn stop(mut self, desktop: &Desktop) -> Result<()> {
        signal(&self.process.0, "INT").context("cannot stop wf-recorder")?;
        let ended = wait(Duration::from_secs(10), "wf-recorder to finish", || {
            let moved = desktop
                .warp(START.0 - 2, START.1)
                .and_then(|()| desktop.warp(START.0, START.1));
            moved?;
            Ok(self.process.ended())
        })?;
        if !ended.success() {
            return Err(Error::msg(format!(
                "wf-recorder failed ({ended}); see {}",
                self.log.display()
            )));
        }
        Ok(())
    }
}

/// Polls `check` until it returns a value or `limit` passes.
pub(crate) fn wait<T>(
    limit: Duration,
    what: &str,
    mut check: impl FnMut() -> Result<Option<T>>,
) -> Result<T> {
    let start = Instant::now();
    loop {
        if let Some(value) = check()? {
            return Ok(value);
        }
        if start.elapsed() > limit {
            return Err(Error::msg(format!("timed out waiting for {what}")));
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn set_private(dir: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

/// sway's configuration: the shared desktop's, with a fixed output.
fn sway_config() -> String {
    format!(
        "output HEADLESS-1 resolution {WIDTH}x{HEIGHT} scale 1 position 0 0 bg #3b4252 solid_color\n\
         default_border none\n\
         default_floating_border none\n\
         focus_follows_mouse no\n\
         xwayland disable\n"
    )
}

/// The Wayland display name and sway socket of the sway with this `pid` in `runtime`, once it
/// accepts connections. They are found by name, so no path is ever passed through a shell.
fn discover(runtime: &Path, pid: u32) -> Option<(String, String)> {
    use std::os::unix::{fs::MetadataExt as _, net::UnixStream};
    let uid = fs::metadata(runtime).ok()?.uid();
    let socket = runtime.join(format!("sway-ipc.{uid}.{pid}.sock"));
    UnixStream::connect(&socket).ok()?;
    let display = fs::read_dir(runtime)
        .ok()?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .find(|name| name.starts_with("wayland-") && !name.ends_with(".lock"))?;
    Some((display, socket.to_string_lossy().into_owned()))
}

/// Whether a binary PPM (`P6`) has a pixel brighter than text on the dark background.
fn any_lit(ppm: &[u8]) -> bool {
    // The header is three whitespace-separated lines: magic, size and maximum value.
    let mut newlines = 0;
    let Some(start) = ppm.iter().position(|&byte| {
        newlines += usize::from(byte == b'\n');
        newlines == 3
    }) else {
        return false;
    };
    ppm[start + 1..]
        .as_chunks::<3>()
        .0
        .iter()
        .any(|pixel| pixel.iter().any(|&channel| channel > 150))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bright_pixel_is_found_after_the_header() {
        let mut dark = b"P6\n2 1\n255\n".to_vec();
        dark.extend([20, 20, 20, 30, 30, 30]);
        assert!(!any_lit(&dark));
        let mut lit = b"P6\n2 1\n255\n".to_vec();
        lit.extend([20, 20, 20, 30, 220, 30]);
        assert!(any_lit(&lit));
        assert!(!any_lit(b"P6\n"));
    }

    #[test]
    fn the_sway_sockets_are_found_by_name_in_a_path_with_spaces() {
        use std::os::unix::{fs::MetadataExt as _, net::UnixListener};
        let dir =
            std::env::temp_dir().join(format!("study showcase 'x' $y {}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(discover(&dir, 4242), None);
        let uid = fs::metadata(&dir).unwrap().uid();
        let socket = dir.join(format!("sway-ipc.{uid}.4242.sock"));
        let _listener = UnixListener::bind(&socket).unwrap();
        assert_eq!(discover(&dir, 4242), None, "no display yet");
        fs::write(dir.join("wayland-1.lock"), "").unwrap();
        assert_eq!(discover(&dir, 4242), None, "a lock is not a display");
        fs::write(dir.join("wayland-1"), "").unwrap();
        assert_eq!(
            discover(&dir, 4242),
            Some((
                "wayland-1".to_owned(),
                socket.to_string_lossy().into_owned()
            ))
        );
        assert_eq!(discover(&dir, 1), None, "another sway's socket");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_config_pins_the_output_and_runs_nothing() {
        let config = sway_config();
        assert!(config.contains(&format!("resolution {WIDTH}x{HEIGHT} scale 1")));
        assert!(!config.contains("exec"));
    }
}
