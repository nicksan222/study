//! Every recording as 16 kHz mono `f32`, the form speech models read.
//!
//! [`Audio::load`] runs one pipeline: decode, downmix to mono, resample to [`SAMPLE_RATE`].
//!
//! | File          | What it holds                                                          |
//! |---------------|------------------------------------------------------------------------|
//! | `mod.rs`      | [`AudioInput`], [`Audio`] and the load pipeline                        |
//! | `decode.rs`   | Study's own decoder: Symphonia, plus Opus                              |
//! | `ffmpeg.rs`   | The fallback for formats and codecs the decoder doesn't know           |
//! | `resample.rs` | Band-limited [`resample()`]ing, to 16 kHz or between any two rates     |

mod decode;
mod ffmpeg;
mod resample;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use symphonia::core::io::MediaSource;

use crate::error::{Error, Result};
use decode::Unread;

pub use resample::resample;

/// Sample rate every speech model reads.
pub const SAMPLE_RATE: u32 = 16_000;

/// Audio to transcribe: a recording in any format [`Audio::load`] reads (WAV, FLAC, MP3, Ogg,
/// MP4/AAC…).
#[derive(Clone, Debug)]
pub enum AudioInput {
    /// A recording on disk; its extension is the format hint.
    File(PathBuf),
    /// A recording's bytes, such as a stored file.
    Encoded {
        bytes: Vec<u8>,
        /// File extension such as `mp3`, used as a format hint.
        extension: Option<String>,
    },
}

impl From<PathBuf> for AudioInput {
    fn from(path: PathBuf) -> Self {
        Self::File(path)
    }
}

impl From<&Path> for AudioInput {
    fn from(path: &Path) -> Self {
        Self::File(path.to_path_buf())
    }
}

/// A recording still to decode, as an [`AudioInput`] holds it.
enum Recording {
    File(PathBuf),
    Bytes(Vec<u8>),
}

/// 16 kHz mono samples in `[-1, 1]`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Audio {
    samples: Vec<f32>,
}

impl Audio {
    /// Wraps samples that are already 16 kHz mono in `[-1, 1]`.
    pub fn from_mono_16k(samples: Vec<f32>) -> Self {
        Self { samples }
    }

    /// Decodes, downmixes, and resamples an input. CPU-bound: call from a blocking context.
    ///
    /// Study reads the common formats itself. For anything else it falls back to FFmpeg when
    /// that is installed; otherwise the error says the format is not supported.
    pub fn load(input: AudioInput) -> Result<Self> {
        let (recording, extension) = match input {
            AudioInput::File(path) => {
                let extension = path.extension().and_then(|e| e.to_str()).map(str::to_owned);
                (Recording::File(path), extension)
            }
            AudioInput::Encoded { bytes, extension } => (Recording::Bytes(bytes), extension),
        };
        let source: Box<dyn MediaSource + '_> = match &recording {
            Recording::File(path) => Box::new(std::fs::File::open(path)?),
            // Borrowed, so the bytes are still there for FFmpeg.
            Recording::Bytes(bytes) => Box::new(Cursor::new(bytes.as_slice())),
        };
        match decode::decode(source, extension.as_deref()) {
            Ok(decoded) => Self::from_interleaved(decoded.samples, decoded.rate, decoded.channels),
            Err(Unread::Unknown(reason)) => {
                let samples = ffmpeg::load(&recording, extension.as_deref(), reason)?;
                Ok(Self { samples })
            }
            Err(Unread::Failed(error)) => Err(error),
        }
    }

    /// Downmixes interleaved samples to mono and resamples them to 16 kHz.
    fn from_interleaved(samples: Vec<f32>, rate: u32, channels: u16) -> Result<Self> {
        if channels == 0 || rate == 0 {
            return Err(Error::Decode("invalid channel count or sample rate".into()));
        }
        let mono = downmix(samples, usize::from(channels));
        if mono.is_empty() {
            return Err(Error::EmptyAudio);
        }
        let samples = resample(mono, rate, SAMPLE_RATE)?;
        Ok(Self { samples })
    }

    /// The samples, 16 kHz mono in `[-1, 1]`.
    pub fn samples(&self) -> &[f32] {
        &self.samples
    }

    /// Length in seconds.
    pub fn duration_secs(&self) -> f64 {
        self.samples.len() as f64 / f64::from(SAMPLE_RATE)
    }
}

/// Averages each frame's channels into one sample.
fn downmix(samples: Vec<f32>, channels: usize) -> Vec<f32> {
    if channels == 1 {
        return samples;
    }
    samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use study_core::{Classify, ErrorKind};

    use super::*;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/jfk_2s.wav");

    /// A sine at half scale.
    fn sine(freq: f32, rate: u32, secs: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| (i as f32 * freq * std::f32::consts::TAU / rate as f32).sin() * 0.5)
            .collect()
    }

    /// Counts upward zero crossings: one per period of a sine.
    fn periods(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|w| w[0] < 0.0 && w[1] >= 0.0)
            .count()
    }

    #[test]
    fn loads_the_fixture_as_two_seconds_of_16k_mono() {
        let audio = Audio::load(AudioInput::from(Path::new(FIXTURE))).expect("decodes");
        assert_eq!(audio.samples().len(), 32_000);
        assert!(audio.samples().iter().any(|s| s.abs() > 0.1), "has speech");
    }

    #[test]
    fn resamples_and_downmixes_raw_pcm() {
        let mono = sine(440.0, 44_100, 1.0);
        let stereo: Vec<f32> = mono.iter().flat_map(|&s| [s, s]).collect();
        let audio = Audio::from_interleaved(stereo, 44_100, 2).expect("resamples");
        assert!((audio.samples().len() as i64 - 16_000).abs() < 16);
        assert!((periods(audio.samples()) as i64 - 440).abs() <= 2);
    }

    #[test]
    fn rejects_garbage_and_empty_input() {
        let garbage = AudioInput::Encoded {
            bytes: b"definitely not audio".to_vec(),
            extension: None,
        };
        assert!(matches!(
            Audio::load(garbage),
            Err(Error::Unsupported { .. })
        ));
        assert!(matches!(
            Audio::from_interleaved(Vec::new(), 16_000, 1),
            Err(Error::EmptyAudio)
        ));
        assert!(matches!(
            Audio::from_interleaved(vec![0.1; 16], 16_000, 0),
            Err(Error::Decode(_))
        ));
    }

    #[test]
    fn an_extension_with_a_slash_does_not_break_the_temporary_file() {
        let garbage = AudioInput::Encoded {
            bytes: b"definitely not audio".to_vec(),
            extension: Some("a/b".into()),
        };
        let error = Audio::load(garbage).unwrap_err();
        assert_eq!(Classify::kind(&error), ErrorKind::Unsupported, "{error:?}");
    }

    #[test]
    fn resamples_between_any_two_rates_keeping_the_pitch() {
        let tone = sine(440.0, SAMPLE_RATE, 1.0);
        let up = resample(tone.clone(), SAMPLE_RATE, 48_000).expect("resamples");
        assert!((up.len() as i64 - 48_000).abs() < 48, "{}", up.len());
        assert!((periods(&up) as i64 - 440).abs() <= 2);
        assert_eq!(
            resample(tone.clone(), SAMPLE_RATE, SAMPLE_RATE).unwrap(),
            tone
        );
    }
}
