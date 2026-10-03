//! Turns the screen recording into the README's GIF with FFmpeg: one palette made from the
//! clip, so text stays readable in few colors, and a loop that never ends. The recording keeps
//! its own size, so small text is not softened, and its last moments dissolve into its first
//! frame so the loop has no seam.

use std::{
    path::{Path, PathBuf},
    process::Command,
};

use study_core::{Context as _, Error, Result};

/// What GitHub shows inline without trouble.
const MAX_BYTES: u64 = 10_000_000;
const FPS: u32 = 11;
/// How long the end of the clip dissolves into its first frame, so the loop has no seam.
const FADE: f64 = 0.4;
/// How long the first frame then holds still, so the dissolve ends fully on it.
const HOLD: f64 = 0.3;

/// Encodes `recording` into `output`, replacing it only if the new GIF is within bounds. The
/// GIF is made next to the recording and copied into place, so a run that dies half way
/// never leaves a stray file in `output`'s directory.
pub fn gif(recording: &Path, output: &Path) -> Result<()> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let partial = partial_path(recording, output);
    let first = recording.with_file_name("first.png");
    let grabbed = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(recording)
        .args(["-frames:v", "1"])
        .arg(&first)
        .status()
        .context("cannot run ffmpeg")?;
    if !grabbed.success() {
        return Err(Error::msg(format!(
            "ffmpeg cannot read the recording: {grabbed}"
        )));
    }
    let status = Command::new("ffmpeg")
        .args(arguments(recording, &first, &partial, duration(recording)?))
        .status()
        .context("cannot run ffmpeg")?;
    let size = std::fs::metadata(&partial).map_or(0, |meta| meta.len());
    if !status.success() || size == 0 {
        std::fs::remove_file(&partial).ok();
        return Err(Error::msg(format!("ffmpeg failed: {status}")));
    }
    if size > MAX_BYTES {
        std::fs::remove_file(&partial).ok();
        return Err(Error::msg(format!(
            "the GIF is {size} bytes, over the {MAX_BYTES} limit: shorten the tour"
        )));
    }
    std::fs::copy(&partial, output)?;
    std::fs::remove_file(&partial).ok();
    Ok(())
}

/// Where the GIF is written until it is known to be good: beside the recording.
fn partial_path(recording: &Path, output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_owned();
    name.push(".partial");
    recording.with_file_name(name)
}

/// How long the recording is, in seconds.
fn duration(recording: &Path) -> Result<f64> {
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration"])
        .args(["-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(recording)
        .output()
        .context("cannot run ffprobe")?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .map_err(|_| Error::msg("ffprobe did not report the recording's length"))
}

/// The filter graph: the recording at its own size, its last [`FADE`] seconds dissolved into
/// the still of its first frame (the second input), which then holds for [`HOLD`], and one palette for the whole clip.
fn filter(duration: f64) -> String {
    let offset = (duration - FADE).max(0.0);
    format!(
        "[0:v]fps={FPS},format=yuv420p[body];\
         [1:v]fps={FPS},format=yuv420p[head];\
         [body][head]xfade=transition=fade:duration={FADE}:offset={offset:.3},split[a][b];\
         [a]palettegen=stats_mode=diff[p];\
         [b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
    )
}

fn arguments(
    recording: &Path,
    first: &Path,
    output: &Path,
    duration: f64,
) -> Vec<std::ffi::OsString> {
    let filter = filter(duration);
    let mut args: Vec<std::ffi::OsString> =
        ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]
            .map(Into::into)
            .into();
    args.push(recording.into());
    args.extend(
        [
            "-loop",
            "1",
            "-framerate",
            &FPS.to_string(),
            "-t",
            &(FADE + HOLD).to_string(),
            "-i",
        ]
        .map(Into::into),
    );
    args.push(first.into());
    args.extend(
        [
            "-filter_complex",
            &filter,
            "-an",
            "-map_metadata",
            "-1",
            "-loop",
            "0",
            "-f",
            "gif",
        ]
        .map(Into::into),
    );
    args.push(output.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gif_loops_and_uses_one_palette() {
        let args = arguments(
            Path::new("in.mkv"),
            Path::new("first.png"),
            Path::new("out.gif.partial"),
            20.0,
        );
        let args: Vec<_> = args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let at = |name: &str| args.iter().rposition(|arg| arg == name).unwrap();
        assert_eq!(args[at("-loop") + 1], "0");
        assert!(args[at("-filter_complex") + 1].contains("palettegen"));
        assert!(!args[at("-filter_complex") + 1].contains("lanczos"));
        assert_eq!(args.last().unwrap(), "out.gif.partial");
    }

    #[test]
    fn the_end_dissolves_into_the_start() {
        let graph = filter(20.0);
        assert!(graph.contains("xfade=transition=fade:duration=0.4:offset=19.600"));
        assert!(filter(0.2).contains("offset=0.000"));
    }

    #[test]
    fn the_partial_file_sits_beside_the_recording() {
        assert_eq!(
            partial_path(Path::new("work/tour.mkv"), Path::new("assets/demo.gif")),
            Path::new("work/demo.gif.partial")
        );
    }
}
