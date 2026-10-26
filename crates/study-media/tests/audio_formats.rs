//! Real recordings of the same two seconds of speech in every format people record in:
//! phone voice notes, lecture recorders, podcasts, and video. Each must decode to about two
//! seconds of 16 kHz mono that still sounds like speech.
//!
//! `jfk_2s.wav` is a public-domain clip of President Kennedy, the `formats/` recordings were
//! transcoded from it with FFmpeg, and `two_pages.pdf` was written by hand.

use std::path::Path;

use study_core::{Classify, ErrorKind};
use study_media::audio::{Audio, AudioInput};

/// Every fixture in `tests/fixtures/formats/`; a new format adds its file here.
const FILES: &[&str] = &[
    "speech.mp3",
    "speech.m4a",
    "speech-alac.m4a",
    "speech.aac",
    "speech.flac",
    "speech.ogg",
    "voice-note.ogg",
    "speech.opus",
    "speech.webm",
    "speech-48k-24bit.wav",
    "speech.aiff",
    "speech.amr",
    "speech.wma",
    "lecture.mp4",
    "lecture.mov",
    "../jfk_2s.wav",
];

/// Formats Study reads through FFmpeg.
const NEEDS_FFMPEG: &[&str] = &["speech.amr", "speech.wma"];

fn ffmpeg_installed() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/formats")
        .join(name)
}

fn loudness(samples: &[f32]) -> f32 {
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt()
}

#[test]
fn every_common_recording_format_decodes_to_speech() {
    let reference = Audio::load(AudioInput::File(fixture("../jfk_2s.wav"))).unwrap();
    let reference_loudness = loudness(reference.samples());
    let mut failures = Vec::new();
    for &name in FILES {
        let path = fixture(name);
        let extension = path.extension().and_then(|e| e.to_str()).map(str::to_owned);
        // The app hands extractors the stored bytes, so test that path rather than the file one.
        let input = AudioInput::Encoded {
            bytes: std::fs::read(&path).unwrap(),
            extension,
        };
        match Audio::load(input) {
            Ok(audio) => {
                let seconds = audio.duration_secs();
                let level = loudness(audio.samples()) / reference_loudness;
                // AAC in a video adds about a tenth of a second of encoder padding.
                if !(1.95..=2.15).contains(&seconds) || !(0.5..=2.0).contains(&level) {
                    failures.push(format!("{name}: {seconds:.2} s, loudness x{level:.2}"));
                }
            }
            // Only FFmpeg reads these; without it the error says it is missing.
            Err(error @ study_media::Error::Unsupported { .. })
                if NEEDS_FFMPEG.contains(&name) && !ffmpeg_installed() =>
            {
                assert!(error.to_string().contains("FFmpeg"), "{name}: {error}");
            }
            Err(error) => failures.push(format!("{name}: {error}")),
        }
    }
    assert!(
        failures.is_empty(),
        "formats that failed:\n{}",
        failures.join("\n")
    );
}

#[test]
fn a_file_that_is_not_a_recording_says_so() {
    let error = Audio::load(AudioInput::Encoded {
        bytes: b"placeholder for lecture.mp3".to_vec(),
        extension: Some("mp3".into()),
    })
    .unwrap_err();
    assert_eq!(Classify::kind(&error), ErrorKind::Unsupported);
    if ffmpeg_installed() {
        // FFmpeg tried too, and its reason is kept beside Study's.
        assert!(
            error.to_string().starts_with("not a recording: ")
                && error.to_string().contains("; FFmpeg: "),
            "{error}"
        );
    } else {
        assert!(
            error
                .to_string()
                .starts_with("cannot read MP3 audio without FFmpeg: "),
            "{error}"
        );
    }
}

#[test]
fn a_damaged_recording_in_a_known_format_is_invalid_not_unsupported() {
    // Study reads the container and starts decoding, then meets garbage mid-stream: the
    // recording is broken, whether or not FFmpeg is installed.
    let mut bytes = std::fs::read(fixture("speech.m4a")).unwrap();
    let middle = bytes.len() * 2 / 5..bytes.len() / 2;
    bytes[middle].fill(0xFF);
    let error = Audio::load(AudioInput::Encoded {
        bytes,
        extension: Some("m4a".into()),
    })
    .unwrap_err();
    assert!(matches!(error, study_media::Error::Decode(_)), "{error:?}");
    assert_eq!(Classify::kind(&error), ErrorKind::InvalidInput);
}

#[test]
fn a_recording_with_a_corrupt_packet_still_decodes() {
    // MP4 frames each packet in its tables, so zeroes in the middle of the audio data ruin
    // one packet and leave the rest of the recording readable.
    let mut bytes = std::fs::read(fixture("speech.m4a")).unwrap();
    let middle = bytes.len() / 2;
    bytes[middle..middle + 16].fill(0);
    let audio = Audio::load(AudioInput::Encoded {
        bytes,
        extension: Some("m4a".into()),
    })
    .unwrap();
    let seconds = audio.duration_secs();
    assert!((1.95..=2.15).contains(&seconds), "{seconds}");
}

#[test]
fn a_playlist_cannot_make_ffmpeg_read_another_file() {
    let playlist = format!(
        "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n{}\n#EXT-X-ENDLIST\n",
        fixture("speech.mp3").display()
    );
    let error = Audio::load(AudioInput::Encoded {
        bytes: playlist.into_bytes(),
        extension: Some("m3u8".into()),
    })
    .unwrap_err();
    assert_eq!(Classify::kind(&error), ErrorKind::Unsupported, "{error:?}");
    if ffmpeg_installed() {
        // FFmpeg ran and refused it, rather than being missing.
        assert!(error.to_string().contains("; FFmpeg: "), "{error}");
    }
}
