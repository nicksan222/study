//! End-to-end run of the default local provider on real speech.
//!
//! The first run downloads the pinned Parakeet TDT v3 model (about 670 MB) into the app cache, so
//! the test is opt-in: `just test-transcription-e2e`.

use std::path::Path;
use std::time::Instant;

use futures::future::join_all;
use study_ai::stt::Transcriber;

/// Two seconds from John F. Kennedy's 1961 inaugural address (public domain):
/// "And so, my fellow Americans".
const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../study-media/tests/fixtures/jfk_2s.wav"
);

fn words(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Loading never downloads, so the tests install the model first; a no-op once it is.
async fn install() {
    study_ai::stt::provider::LocalConfig::default()
        .model()
        .install()
        .await
        .expect("the model installs");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "downloads a 670 MB model on first run; use `just test-transcription-e2e`"]
async fn default_local_provider_transcribes_two_seconds_of_speech() {
    let loading = Instant::now();
    install().await;
    let transcriber = Transcriber::local().await.expect("local model loads");
    eprintln!("model ready in {:.1?}", loading.elapsed());
    assert_eq!(transcriber.provider_name(), "parakeet-tdt-0.6b-v3");

    let running = Instant::now();
    let transcript = transcriber
        .transcribe(Path::new(FIXTURE))
        .await
        .expect("transcribes");
    eprintln!("transcribed in {:.1?}: {transcript:#?}", running.elapsed());

    assert_eq!(words(&transcript.text), "and so my fellow americans");
    assert!((transcript.duration_secs - 2.0).abs() < 1e-6);
    assert!(!transcript.segments.is_empty());
    for segment in &transcript.segments {
        assert!(0.0 <= segment.start_secs && segment.start_secs < segment.end_secs);
        assert!(segment.end_secs <= 2.0 + 1e-3);
    }

    // The same clip three times concurrently goes through one batch and matches the single run.
    let batched = join_all((0..3).map(|_| transcriber.transcribe(Path::new(FIXTURE)))).await;
    for result in batched {
        assert_eq!(result.expect("transcribes").text, transcript.text);
    }
}

/// The same speech as a phone voice note, a lecture recorder file, and a video, so the model
/// is proven on what people actually attach, not only on WAV.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "downloads a 670 MB model on first run; use `just test-transcription-e2e`"]
async fn real_recordings_in_common_formats_transcribe_the_same() {
    install().await;
    let transcriber = Transcriber::local().await.expect("local model loads");
    let formats =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../study-media/tests/fixtures/formats");
    for name in [
        "voice-note.ogg",
        "speech.m4a",
        "speech.mp3",
        "speech.webm",
        "lecture.mp4",
    ] {
        let transcript = transcriber
            .transcribe(formats.join(name).as_path())
            .await
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        // The clip ends on the "s" of "Americans"; a low-bitrate voice note can lose that
        // last sibilant at the very edge, so only the words before it must match exactly.
        let heard = words(&transcript.text);
        assert!(
            heard.starts_with("and so my fellow american"),
            "{name}: {heard}"
        );
    }
}
