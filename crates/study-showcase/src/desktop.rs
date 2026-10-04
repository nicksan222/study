//! The private desktop the showcase runs on: a headless sway of its own, the app, the screen
//! recorder, and the few ways to look at the screen, capture it and press keys and buttons.
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

/// The output: its size in logical pixels, which is what every coordinate means, and how
/// many real pixels each one is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Screen {
    pub width: u32,
    pub height: u32,
    pub scale: u32,
}

impl Screen {
    /// The GIF's: it shows exactly these pixels at scale 1.
    pub const DEMO: Self = Self {
        width: 1920,
        height: 1080,
        scale: 1,
    };
    /// The docs': a laptop-sized window at twice the density, so stills stay sharp on a
    /// high-density screen.
    pub const DOCS: Self = Self {
        width: 1440,
        height: 900,
        scale: 2,
    };

    /// Where the pointer rests when the app is ready: on the welcome tour's "Skip".
    pub const fn start(self) -> (u32, u32) {
        (self.width - 40, 22)
    }

    /// Where the welcome tour's "Skip" sits.
    const fn skip(self) -> Region {
        Region {
            x: self.width - 75,
            y: 10,
            width: 70,
            height: 24,
        }
    }
}

/// The app's window ID, a copy of the one in `apps/desktop/src/app/desktop.rs`: this crate
/// cannot depend on the binary. If it changes there, the wait for the window times out here.
const APP_ID: &str = "io.github.nicksan222.Study";

/// Time for the app to draw before the welcome tour's Skip is pressed, and for the shell to
/// settle after it.
const BEFORE_SKIP: Duration = Duration::from_secs(1);
const AFTER_SKIP: Duration = Duration::from_secs(2);
/// Time for the recorder to write its first frame before the steps start.
pub const FIRST_FRAME: Duration = Duration::from_millis(800);
/// How long a button is held down.
pub const PRESS_MS: u64 = 60;
/// How long a still waits for the screen to stop changing before it is taken anyway, and
/// for a hidden pointer to leave the picture.
const SETTLE: Duration = Duration::from_secs(6);
const POINTER_GONE: Duration = Duration::from_millis(400);
/// How far apart the darkest and brightest pixel of a region must be for something to be
/// drawn there, in either theme: text on its background, not one flat color.
const CONTRAST: u8 = 100;

/// The rail's first row once the shell shows.
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

/// A running sway with its environment. Stops sway when dropped.
pub struct Desktop {
    sway: Child,
    screen: Screen,
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

/// A rectangle of the screen, in logical pixels.
#[derive(Clone, Copy)]
struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl Desktop {
    /// Starts sway on `screen`, with a runtime directory and configuration under `work`.
    pub fn start(repo: &Path, work: &Path, screen: Screen) -> Result<Self> {
        let runtime = work.join("rt");
        fs::remove_dir_all(&runtime).ok();
        fs::create_dir_all(&runtime)?;
        set_private(&runtime)?;
        let config = work.join("sway.config");
        fs::write(&config, sway_config(screen))?;

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
            screen,
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

    /// Whether something is drawn in `region`: it is not one flat color.
    fn is_drawn(&self, region: Region) -> bool {
        let geometry = format!(
            "{},{} {}x{}",
            region.x, region.y, region.width, region.height
        );
        self.command("grim")
            .args(["-t", "ppm", "-g", &geometry, "-"])
            .output()
            .is_ok_and(|output| output.status.success() && has_contrast(&output.stdout))
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
            Ok(self.is_drawn(self.screen.skip()).then_some(()))
        })?;
        thread::sleep(BEFORE_SKIP);
        let (x, y) = self.screen.start();
        self.click(x, y)?;
        wait(Duration::from_secs(60), "the app's shell", || {
            app.check_running(work)?;
            Ok(self.is_drawn(RAIL).then_some(()))
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
        self.button(true)?;
        thread::sleep(Duration::from_millis(PRESS_MS));
        self.button(false)
    }

    /// Holds the left button down, or lets it go: the two ends of a drag.
    pub fn button(&self, down: bool) -> Result<()> {
        let action = if down { "press" } else { "release" };
        self.swaymsg(&["seat", "-", "cursor", action, "button1"])
            .map(drop)
    }

    /// Takes a still of the whole output at its full density into `path` (a PNG), once
    /// the screen has stopped changing, without the pointer in it. A screen that never
    /// settles (a spinner) is taken anyway after a few seconds, with a warning.
    pub fn capture(&self, path: &Path) -> Result<()> {
        self.swaymsg(&["seat", "-", "hide_cursor", "1"])?;
        thread::sleep(POINTER_GONE);
        let settled = self.settle();
        let taken = self.run("grim", &["-t", "png", &path.to_string_lossy()]);
        self.swaymsg(&["seat", "-", "hide_cursor", "0"])?;
        if !settled? {
            eprintln!(
                "warning: the screen kept changing; took {} anyway",
                path.display()
            );
        }
        taken
    }

    /// Waits until two grabs of the screen a moment apart are the same, and says whether
    /// they ever were before [`SETTLE`] passed.
    fn settle(&self) -> Result<bool> {
        let grab = || -> Result<Vec<u8>> {
            let output = self
                .command("grim")
                .args(["-t", "ppm", "-s", "1", "-"])
                .output()
                .context("cannot run grim")?;
            if !output.status.success() {
                return Err(Error::msg(format!("grim failed: {}", output.status)));
            }
            Ok(output.stdout)
        };
        let start = Instant::now();
        let mut last = grab()?;
        while start.elapsed() < SETTLE {
            thread::sleep(Duration::from_millis(300));
            let next = grab()?;
            if next == last {
                return Ok(true);
            }
            last = next;
        }
        Ok(false)
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
    /// recorder no frame to notice the request on, so the pointer, resting at `at`, is
    /// nudged until it ends and comes back there. On a small machine rendering in software
    /// (a CI runner) it may still be encoding the frames it holds, so it gets a minute.
    pub fn stop(mut self, desktop: &Desktop, at: (u32, u32)) -> Result<()> {
        signal(&self.process.0, "INT").context("cannot stop wf-recorder")?;
        let ended = wait(Duration::from_secs(60), "wf-recorder to finish", || {
            let moved = desktop
                .warp(at.0.saturating_sub(2), at.1)
                .and_then(|()| desktop.warp(at.0, at.1));
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
fn sway_config(screen: Screen) -> String {
    let Screen {
        width,
        height,
        scale,
    } = screen;
    let (width, height) = (width * scale, height * scale);
    format!(
        "output HEADLESS-1 resolution {width}x{height} scale {scale} position 0 0 bg #3b4252 solid_color\n\
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

/// Whether a binary PPM (`P6`) holds both a dark and a bright pixel, [`CONTRAST`] apart in
/// some channel: text on its background in a light or a dark theme.
fn has_contrast(ppm: &[u8]) -> bool {
    // The header is three whitespace-separated lines: magic, size and maximum value.
    let mut newlines = 0;
    let Some(start) = ppm.iter().position(|&byte| {
        newlines += usize::from(byte == b'\n');
        newlines == 3
    }) else {
        return false;
    };
    let (low, high) = ppm[start + 1..]
        .iter()
        .fold((u8::MAX, u8::MIN), |(low, high), &channel| {
            (low.min(channel), high.max(channel))
        });
    high.saturating_sub(low) >= CONTRAST
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_found_on_a_dark_or_a_light_background_but_not_a_flat_one() {
        let ppm = |pixels: [u8; 6]| {
            let mut ppm = b"P6\n2 1\n255\n".to_vec();
            ppm.extend(pixels);
            ppm
        };
        assert!(!has_contrast(&ppm([20, 20, 20, 30, 30, 30])));
        assert!(!has_contrast(&ppm([240, 240, 240, 250, 250, 250])));
        assert!(has_contrast(&ppm([20, 20, 20, 30, 220, 30])));
        assert!(has_contrast(&ppm([250, 250, 250, 40, 40, 40])));
        assert!(!has_contrast(b"P6\n"));
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
        let config = sway_config(Screen::DEMO);
        assert!(config.contains("resolution 1920x1080 scale 1"));
        assert!(!config.contains("exec"));
        assert!(sway_config(Screen::DOCS).contains("resolution 2880x1800 scale 2"));
    }
}
