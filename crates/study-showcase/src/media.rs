//! Bounded FFmpeg conversion of local recordings into small PR attachments.
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use study_core::{Context as _, Result};
use tempfile::NamedTempFile;
use tokio::{process::Command, time::timeout};

const MAX_BYTES: u64 = 8_000_000;

/// Convert at most 15 seconds, without audio, into an MP4 or GIF under 8 MB.
/// Existing outputs are never replaced, including if another writer wins during encoding.
pub async fn convert(source: &Path, destination: &Path) -> Result<PathBuf> {
    let source = source
        .canonicalize()
        .with_context(|| format!("read recording {}", source.display()))?;
    if !source.is_file() {
        return Err(study_core::err!(
            "recording is not a file: {}",
            source.display()
        ));
    }
    let destination = std::path::absolute(destination)?;
    if destination.try_exists()? {
        return Err(study_core::err!(
            "output already exists: {}",
            destination.display()
        ));
    }
    let extension = match destination
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("mp4") => ".mp4",
        Some("gif") => ".gif",
        _ => return Err(study_core::err!("output must end in .mp4 or .gif")),
    };
    let parent = destination
        .parent()
        .context("output needs a parent directory")?;
    fs::create_dir_all(parent)?;
    let temporary = tempfile::Builder::new()
        .prefix(".study-showcase-")
        .suffix(extension)
        .tempfile_in(parent)?;
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(source)
        .args(["-t", "15", "-an", "-map_metadata", "-1"]);
    if extension == ".mp4" {
        command.args([
            "-vf",
            r"fps=12,scale=min(1280\,iw):-2",
            "-c:v",
            "libx264",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ]);
    } else {
        command.args(["-filter_complex", r"fps=10,scale=min(960\,iw):-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse", "-loop", "0"]);
    }
    command.arg(temporary.path());
    encode(&mut command, Duration::from_secs(120)).await?;
    publish(temporary, &destination)?;
    Ok(destination)
}

async fn encode(command: &mut Command, limit: Duration) -> Result<()> {
    let status = timeout(limit, command.kill_on_drop(true).status())
        .await
        .context("recording conversion timed out")?
        .context("run installed FFmpeg")?;
    if !status.success() {
        return Err(study_core::err!(
            "recording conversion exited with {status}"
        ));
    }
    Ok(())
}

fn publish(temporary: NamedTempFile, destination: &Path) -> Result<()> {
    let size = temporary.as_file().metadata()?.len();
    if size == 0 || size > MAX_BYTES {
        return Err(study_core::err!(
            "showcase must be 1–8,000,000 bytes; shorten the clip or use MP4"
        ));
    }
    temporary
        .persist_noclobber(destination)
        .context("publish recording without replacing an existing file")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};

    #[tokio::test]
    async fn real_recording_is_trimmed_silent_and_never_upscaled() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("recording.mp4");
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=96x64:r=4:d=16",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=16",
                "-metadata",
                "title=private recording",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        for extension in ["mp4", "gif"] {
            let destination = directory
                .path()
                .join(format!("converted recording.{extension}"));
            assert_eq!(convert(&source, &destination).await.unwrap(), destination);
            let size = fs::metadata(&destination).unwrap().len();
            assert!(size > 0 && size <= 8_000_000);
            let probe = Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-show_format",
                    "-show_streams",
                    "-of",
                    "json",
                ])
                .arg(&destination)
                .output()
                .unwrap();
            assert!(probe.status.success());
            let value: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
            assert_eq!(value["streams"].as_array().unwrap().len(), 1);
            assert_eq!(value["streams"][0]["codec_type"], "video");
            assert!(value["streams"][0]["width"].as_u64().unwrap() <= 96);
            assert!(value["streams"][0]["height"].as_u64().unwrap() <= 64);
            let duration = value["format"]["duration"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap();
            assert!(duration > 0.0 && duration <= 15.1, "{duration}");
            assert!(value["format"]["tags"]["title"].is_null());
        }
    }

    #[test]
    fn publishing_rejects_empty_oversized_or_existing_outputs() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("output.mp4");
        for size in [0, MAX_BYTES + 1] {
            let temporary = NamedTempFile::new_in(directory.path()).unwrap();
            temporary.as_file().set_len(size).unwrap();
            assert!(publish(temporary, &destination).is_err());
            assert!(!destination.exists());
        }
        fs::write(&destination, b"existing").unwrap();
        let temporary = NamedTempFile::new_in(directory.path()).unwrap();
        temporary.as_file().set_len(1).unwrap();
        assert!(publish(temporary, &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"existing");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn timed_out_encoder_is_killed_and_reaped() {
        let directory = tempfile::tempdir().unwrap();
        let pid_file = directory.path().join("encoder.pid");
        let mut command = tokio::process::Command::new("sh");
        command
            .args(["-c", "echo $$ > \"$1\"; exec sleep 30", "encoder"])
            .arg(&pid_file);
        assert!(
            encode(&mut command, Duration::from_millis(200))
                .await
                .is_err()
        );
        let pid = fs::read_to_string(&pid_file).unwrap();
        let process = Path::new("/proc").join(pid.trim());
        tokio::time::timeout(Duration::from_secs(1), async {
            while process.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("timed-out encoder must not be left running or unreaped");
    }

    #[tokio::test]
    async fn failed_conversion_leaves_no_output_and_existing_files_are_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("broken.mp4");
        fs::write(&source, b"not a recording").unwrap();
        let destination = directory.path().join("output.mp4");
        assert!(convert(&source, &destination).await.is_err());
        assert!(!destination.exists());
        fs::write(&destination, b"keep this file").unwrap();
        assert!(convert(&source, &destination).await.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"keep this file");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }
}
