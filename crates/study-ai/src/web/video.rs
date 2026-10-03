//! [`fetch_video_audio`]: a video's sound track, through the `yt-dlp` program.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use study_core::db::MAX_SOURCE_BYTES;
use tokio::process::Command;

use super::{Error, Result};

/// Longest a download may take.
const TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// A video's sound track, ready to store as an audio source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoAudio {
    /// A file name from the video's title, with the audio's extension.
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Whether `url` is a video page `yt-dlp` fetches the sound of, such as a YouTube video.
pub fn is_video(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.");
    match host {
        "youtu.be" => url.path().len() > 1,
        "youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            url.path() == "/watch"
                || url.path().starts_with("/shorts/")
                || url.path().starts_with("/live/")
        }
        _ => false,
    }
}

/// Downloads the best audio-only stream of the video at `url` with `yt-dlp`, which must be
/// installed. No conversion is done, so FFmpeg is not needed: Study decodes the stream.
pub async fn fetch_video_audio(url: &str) -> Result<VideoAudio> {
    if !is_video(url) {
        return Err(Error::Address(url.to_owned()));
    }
    let directory = tempfile::tempdir()?;
    let child = match yt_dlp(directory.path(), url).spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(Error::VideoToolMissing);
        }
        Err(error) => return Err(error.into()),
    };
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| Error::VideoTool("the download took too long".into()))??;
    if !output.status.success() {
        let reason = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(Error::VideoTool(if reason.is_empty() {
            output.status.to_string()
        } else {
            reason
        }));
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .last()
        .map(|line| PathBuf::from(line.trim()))
        .filter(|path| path.starts_with(directory.path()))
        .ok_or_else(|| Error::VideoTool("it did not say where it saved the audio".into()))?;
    // `--max-filesize` cannot bound a stream of unknown size, so check before reading.
    if tokio::fs::metadata(&path).await?.len() > MAX_SOURCE_BYTES {
        return Err(Error::TooLarge(MAX_SOURCE_BYTES));
    }
    let bytes = tokio::fs::read(&path).await?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video.m4a".into());
    Ok(VideoAudio { name, bytes })
}

/// `yt-dlp` saving the best audio-only stream of `url` into `directory`, named after the
/// video's title, and printing where it saved it.
fn yt_dlp(directory: &Path, url: &str) -> Command {
    let mut command = Command::new(program());
    command
        .args(["--no-playlist", "--no-progress", "--quiet", "--no-warnings"])
        .args(["-f", "bestaudio[ext=m4a]/bestaudio"])
        .arg("-o")
        // The title cut to 80 bytes, well inside every file system's limit on a name.
        .arg(directory.join("%(title).80B.%(ext)s"))
        .args(["--print", "after_move:filepath"])
        // So the download is never read into memory unbounded.
        .arg("--max-filesize")
        .arg(format!("{}M", MAX_SOURCE_BYTES >> 20))
        // After `--`, an address is never read as an option.
        .arg("--")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

/// `yt-dlp` on the `PATH`.
fn program() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_addresses_are_told_apart_from_pages() {
        assert!(is_video("https://www.youtube.com/watch?v=abc"));
        assert!(is_video("https://youtu.be/abc"));
        assert!(is_video("https://youtube.com/shorts/abc"));
        assert!(!is_video("https://www.youtube.com/@channel"));
        assert!(!is_video("https://youtu.be/"));
        assert!(!is_video("https://example.org/watch"));
        assert!(!is_video("not a url"));
    }

    #[test]
    fn the_address_is_never_read_as_an_option() {
        let command = yt_dlp(Path::new("/tmp/study"), "--exec=rm");
        let args: Vec<_> = command.as_std().get_args().collect();
        assert_eq!(args[args.len() - 2..], ["--", "--exec=rm"]);
    }

    #[tokio::test]
    async fn only_video_pages_are_handed_to_yt_dlp() {
        let error = fetch_video_audio("https://example.org/lecture.mp4")
            .await
            .unwrap_err();
        assert!(matches!(error, Error::Address(_)), "{error}");
    }

    #[tokio::test]
    #[ignore = "needs the internet and yt-dlp"]
    async fn a_youtube_videos_sound_track_is_downloaded_ready_to_decode() {
        use study_media::audio::{Audio, AudioInput};

        // "Me at the zoo", the first YouTube video: 19 seconds long.
        let audio = fetch_video_audio("https://www.youtube.com/watch?v=jNQXAC9IVRw")
            .await
            .unwrap();
        assert_eq!(audio.name, "Me at the zoo.m4a");

        let decoded = Audio::load(AudioInput::Encoded {
            bytes: audio.bytes,
            extension: Some("m4a".into()),
        })
        .unwrap();
        assert!((18.0..20.0).contains(&decoded.duration_secs()));
    }

    #[tokio::test]
    #[ignore = "needs the internet and yt-dlp"]
    async fn a_video_that_does_not_exist_says_why() {
        let error = fetch_video_audio("https://www.youtube.com/watch?v=study000000")
            .await
            .unwrap_err();
        let Error::VideoTool(reason) = &error else {
            panic!("yt-dlp fails: {error}");
        };
        assert!(!reason.is_empty());
        assert_eq!(
            study_core::Classify::kind(&error),
            study_core::ErrorKind::InvalidInput
        );
    }
}
