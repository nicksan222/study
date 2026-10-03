//! The last resort for recordings Study cannot read itself (AMR from old phones, WMA, and
//! other rarities): FFmpeg, when it is installed, turns them into plain samples. It may open
//! only local files in the formats listed in `DEMUXERS`.

use std::io::{Read as _, Write as _};
use std::path::Path;
use std::process::{Command, Stdio};

use super::{Recording, SAMPLE_RATE};
use crate::error::{Error, Result};

/// The only demuxers FFmpeg may use, so no playlist or image sequence can open other files.
const DEMUXERS: &str = "aac,ac3,aiff,amr,amrnb,amrwb,ape,asf,au,avi,caf,dts,eac3,flac,matroska,mov,mp3,mpeg,mpegts,ogg,tta,w64,wav,wv,xwma";

/// Decodes a recording Study could not read itself to 16 kHz mono. `reason` is why Study
/// could not; it becomes the [`Error::Unsupported`] reason when FFmpeg is missing, and is
/// joined by FFmpeg's own when FFmpeg cannot read it either. Failing to run FFmpeg, or to
/// write its temporary file, is [`Error::Io`].
pub(super) fn load(
    recording: &Recording,
    extension: Option<&str>,
    reason: String,
) -> Result<Vec<f32>> {
    let run = match recording {
        Recording::File(path) => run(path)?,
        Recording::Bytes(bytes) => {
            // FFmpeg needs to seek in many containers, so give it a real file, named by the
            // extension only when it is a plain word that cannot leave the temporary directory.
            let suffix = extension
                .filter(|e| !e.is_empty() && e.bytes().all(|b| b.is_ascii_alphanumeric()))
                .unwrap_or("bin");
            let mut file = tempfile::Builder::new()
                .suffix(&format!(".{suffix}"))
                .tempfile()?;
            file.write_all(bytes)?;
            run(file.path())?
        }
    };
    match run {
        Run::Decoded(samples) if samples.is_empty() => Err(Error::EmptyAudio),
        Run::Decoded(samples) => Ok(samples),
        Run::Missing => Err(Error::Unsupported {
            format: extension.map(str::to_ascii_uppercase),
            reason,
        }),
        // FFmpeg could not read it either: it is most likely not a recording at all.
        Run::Refused(ffmpeg) => Err(Error::Unsupported {
            format: None,
            reason: format!("{reason}; FFmpeg: {ffmpeg}"),
        }),
    }
}

/// What running FFmpeg on a file came to.
enum Run {
    /// 16 kHz mono samples.
    Decoded(Vec<f32>),
    /// FFmpeg is not installed.
    Missing,
    /// FFmpeg could not read the file; the text is its last error line.
    Refused(String),
}

/// Decodes `path` to 16 kHz mono with FFmpeg.
fn run(path: &Path) -> Result<Run> {
    let child = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            DEMUXERS,
            "-i",
        ])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar"])
        .arg(SAMPLE_RATE.to_string())
        .args(["-f", "f32le", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Run::Missing),
        Err(error) => return Err(Error::Io(error)),
    };
    let mut bytes = Vec::new();
    let mut stdout = child.stdout.take().expect("piped stdout");
    // Read stderr on its own thread so a chatty FFmpeg cannot fill the pipe and stall.
    let mut stderr = child.stderr.take().expect("piped stderr");
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let read = stdout.read_to_end(&mut bytes);
    // Closing the pipe ends FFmpeg if the read failed, so the wait below cannot hang.
    drop(stdout);
    let status = child.wait()?;
    let errors = errors.join().unwrap_or_default();
    read?;
    if !status.success() {
        let reason = errors.lines().last().unwrap_or("unknown error").trim();
        return Ok(Run::Refused(reason.to_owned()));
    }
    Ok(Run::Decoded(
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|sample| f32::from_le_bytes(*sample))
            .collect(),
    ))
}
