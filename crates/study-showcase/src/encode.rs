//! Turns screen recordings and stills into what is published, with FFmpeg.
//!
//! - [`gif`] makes the README's GIF: one palette made from the clip, so text stays readable
//!   in few colors, and a loop that never ends. The recording keeps its own size, so small
//!   text is not softened, and its last moments dissolve into its first frame so the loop
//!   has no seam.
//! - [`clip`] makes a docs clip: H.264 in MP4 that every browser plays, without sound, with
//!   its index at the front so it starts before it has fully loaded, at the smallest quality
//!   loss that keeps it under [`MAX_CLIP_BYTES`].
//! - [`still`] makes a docs still or a clip's poster: lossless WebP, half the bytes of the
//!   PNG it comes from and not one pixel different, so text stays crisp. The site makes
//!   its smaller sizes from it.
//!
//! Each writes its file next to its input first and copies it into place only once it is
//! known to be good, so a run that dies half way never leaves a stray file behind.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

use study_core::{Context as _, Error, Result};

/// What GitHub shows inline without trouble.
const MAX_BYTES: u64 = 10_000_000;
/// What a docs clip may weigh, and the frame rate and width it plays at.
pub const MAX_CLIP_BYTES: u64 = 1_500_000;
const CLIP_FPS: u32 = 30;
const CLIP_WIDTH: u32 = 1440;
/// The H.264 qualities tried in turn, best first, until the clip is small enough.
const CLIP_QUALITIES: [u32; 7] = [20, 24, 27, 30, 33, 36, 39];
const FPS: u32 = 11;
/// How long the end of the clip dissolves into its first frame, so the loop has no seam.
const FADE: f64 = 0.4;
/// How long the first frame then holds still, so the dissolve ends fully on it.
const HOLD: f64 = 0.3;

/// What every FFmpeg run starts with: no banner or progress, and no reading of the terminal.
const QUIET: [&str; 5] = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];

/// Encodes `recording` into `output`, replacing it only if the new GIF is within bounds, and
/// returns its size in bytes. The GIF is made next to the recording and copied into place, so
/// a run that dies half way never leaves a stray file in `output`'s directory.
pub fn gif(recording: &Path, output: &Path) -> Result<u64> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let partial = partial_path(recording, output);
    let first = recording.with_file_name("first.png");
    let mut grab: Vec<OsString> = vec!["-i".into(), recording.into(), "-frames:v".into()];
    grab.extend(["1".into(), first.clone().into()]);
    ffmpeg(&grab, "cannot read the recording")?;
    let encoded = ffmpeg(
        &arguments(recording, &first, &partial, duration(recording)?),
        "cannot encode the GIF",
    );
    let size = std::fs::metadata(&partial).map_or(0, |meta| meta.len());
    if let Err(error) = encoded {
        std::fs::remove_file(&partial).ok();
        return Err(error);
    }
    if size == 0 || size > MAX_BYTES {
        std::fs::remove_file(&partial).ok();
        return Err(Error::msg(format!(
            "the GIF is {size} bytes, outside 1..={MAX_BYTES}: shorten the tour or lower the frame rate"
        )));
    }
    std::fs::copy(&partial, output)?;
    std::fs::remove_file(&partial).ok();
    Ok(size)
}

/// Encodes `length` seconds of `recording`, after its first `skip`, into the MP4 `output`,
/// and returns its size in bytes. The recorder writes a frame only when the screen changes,
/// so the recording stops at the last change: its last frame is held until `length`.
pub fn clip(recording: &Path, output: &Path, skip: f64, length: f64) -> Result<u64> {
    let partial = partial_path(recording, output);
    for quality in CLIP_QUALITIES {
        let encoded = ffmpeg(
            &clip_arguments(recording, &partial, skip, length, quality),
            "cannot encode the clip",
        );
        if let Err(error) = encoded {
            std::fs::remove_file(&partial).ok();
            return Err(error);
        }
        let size = std::fs::metadata(&partial).map_or(0, |meta| meta.len());
        if size > 0 && size <= MAX_CLIP_BYTES {
            return place(&partial, output, size);
        }
    }
    std::fs::remove_file(&partial).ok();
    Err(Error::msg(format!(
        "{} stays over {MAX_CLIP_BYTES} bytes at every quality: shorten its steps",
        output.display()
    )))
}

/// Encodes the PNG `png` into the lossless WebP `output`, `width` pixels wide (its own
/// width if `None`), and returns its size in bytes.
pub fn still(png: &Path, output: &Path, width: Option<u32>) -> Result<u64> {
    let partial = partial_path(png, output);
    let encoded = ffmpeg(
        &still_arguments(png, &partial, width),
        "cannot encode the still",
    );
    let size = std::fs::metadata(&partial).map_or(0, |meta| meta.len());
    if encoded.is_err() || size == 0 {
        std::fs::remove_file(&partial).ok();
        return Err(encoded
            .err()
            .unwrap_or_else(|| Error::msg("the still is empty")));
    }
    place(&partial, output, size)
}

/// Copies the finished `partial` file to `output`, removes it, and passes `size` on.
fn place(partial: &Path, output: &Path, size: u64) -> Result<u64> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(partial, output)?;
    std::fs::remove_file(partial).ok();
    Ok(size)
}

fn clip_arguments(
    recording: &Path,
    output: &Path,
    skip: f64,
    length: f64,
    quality: u32,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-i".into(), recording.into()];
    args.extend(
        [
            "-vf",
            &clip_filter(skip, length),
            "-t",
            &format!("{length:.3}"),
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            &quality.to_string(),
            "-movflags",
            "+faststart",
            "-an",
            "-map_metadata",
            "-1",
            "-f",
            "mp4",
        ]
        .map(Into::into),
    );
    args.push(output.into());
    args
}

/// The recording's last frame held for `length` (padding first: `tpad` after `fps` stops at
/// the last frame and adds nothing), then a steady frame rate made from its changes, its
/// first `skip` seconds cut, and the docs' width in the pixel format and video range every
/// browser decodes alike (the recording is full range).
fn clip_filter(skip: f64, length: f64) -> String {
    format!(
        "tpad=stop_mode=clone:stop_duration={length:.3},\
         fps={CLIP_FPS},trim=start={skip:.3},setpts=PTS-STARTPTS,\
         scale={CLIP_WIDTH}:-2:flags=lanczos:out_range=tv,format=yuv420p"
    )
}

fn still_arguments(png: &Path, output: &Path, width: Option<u32>) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-i".into(), png.into()];
    if let Some(width) = width {
        args.extend([
            "-vf".into(),
            format!("scale={width}:-2:flags=lanczos").into(),
        ]);
    }
    args.extend(
        [
            "-c:v",
            "libwebp",
            "-lossless",
            "1",
            "-compression_level",
            "6",
            "-map_metadata",
            "-1",
            "-f",
            "webp",
        ]
        .map(Into::into),
    );
    args.push(output.into());
    args
}

/// Runs FFmpeg with `args`, and fails with `what` and its exit status if it does.
fn ffmpeg(args: &[OsString], what: &str) -> Result<()> {
    let status = Command::new("ffmpeg")
        .args(QUIET)
        .args(args)
        .status()
        .context("cannot run ffmpeg")?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::msg(format!("ffmpeg {what}: {status}")))
    }
}

/// Where a file is written until it is known to be good: beside its input.
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
/// the still of its first frame (the second input), which then holds for [`HOLD`], and one
/// palette for the whole clip.
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

fn arguments(recording: &Path, first: &Path, output: &Path, duration: f64) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-i".into(), recording.into()];
    args.extend(
        [
            "-loop",
            "1",
            "-framerate",
            &FPS.to_string(),
            "-t",
            &format!("{:.3}", FADE + HOLD),
            "-i",
        ]
        .map(Into::into),
    );
    args.push(first.into());
    args.extend(
        [
            "-filter_complex",
            &filter(duration),
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
        let resized = args[at("-filter_complex") + 1]
            .split([';', ','])
            .any(|step| {
                step.rsplit(']')
                    .next()
                    .unwrap_or(step)
                    .starts_with("scale=")
            });
        assert!(!resized, "the GIF keeps the recording's size");
        assert_eq!(args.last().unwrap(), "out.gif.partial");
    }

    #[test]
    fn the_end_dissolves_into_the_start() {
        let graph = filter(20.0);
        assert!(graph.contains("xfade=transition=fade:duration=0.4:offset=19.600"));
        assert!(filter(0.2).contains("offset=0.000"));
    }

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn a_clip_plays_in_every_browser_and_starts_at_once() {
        let args = strings(&clip_arguments(
            Path::new("in.mkv"),
            Path::new("out.mp4.partial"),
            0.5,
            4.0,
            27,
        ));
        let after = |name: &str| &args[args.iter().position(|arg| arg == name).unwrap() + 1];
        assert_eq!(after("-t"), "4.000");
        assert!(after("-vf").contains("trim=start=0.500"));
        assert!(after("-vf").starts_with("tpad=stop_mode=clone"));
        assert_eq!(after("-c:v"), "libx264");
        assert_eq!(after("-crf"), "27");
        assert_eq!(after("-movflags"), "+faststart");
        assert!(after("-vf").contains("out_range=tv,format=yuv420p"));
        assert!(after("-vf").contains("fps=30"));
        assert!(args.iter().any(|arg| arg == "-an"), "no sound");
    }

    #[test]
    fn a_still_is_lossless_and_resized_only_when_asked() {
        let full = strings(&still_arguments(
            Path::new("a.png"),
            Path::new("a.webp"),
            None,
        ));
        assert!(full.windows(2).any(|pair| pair == ["-lossless", "1"]));
        assert!(!full.iter().any(|arg| arg == "-vf"));
        let poster = strings(&still_arguments(
            Path::new("a.png"),
            Path::new("a.webp"),
            Some(1440),
        ));
        assert!(poster.iter().any(|arg| arg.starts_with("scale=1440:")));
    }

    #[test]
    fn every_quality_is_tried_from_the_best() {
        assert!(CLIP_QUALITIES.is_sorted());
    }

    #[test]
    fn the_partial_file_sits_beside_the_recording() {
        assert_eq!(
            partial_path(Path::new("work/tour.mkv"), Path::new("site/demo.gif")),
            Path::new("work/demo.gif.partial")
        );
    }
}
