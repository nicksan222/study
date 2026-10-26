//! What every recording goes through before any provider hears it, local or online: noise
//! taken out when there is enough to matter, then only the speech, cut into clips the provider
//! accepts. Silence never reaches a provider, so it cannot be heard as words.
//!
//! Both models are small and compiled into Study, so this needs no install and no network.
//!
//! | File         | What it holds                                                      |
//! |--------------|--------------------------------------------------------------------|
//! | `denoise.rs` | RNNoise, applied only to noisy recordings                          |
//! | `vad.rs`     | Silero VAD: the chance each 32 ms frame holds speech               |
//! | `split.rs`   | [`clips`]: speech found, padded, and packed up to the clip limit   |

mod denoise;
mod split;
mod vad;

use study_media::audio::{Audio, SAMPLE_RATE};

use crate::stt::error::Result;

/// The speech in `audio`, as `(offset_secs, clip)` pairs in order, each clip at most
/// `max_clip_secs` long. Empty when nobody speaks. CPU-bound: call from a blocking context.
pub(super) fn clips(audio: Audio, max_clip_secs: f64) -> Result<Vec<(f64, Audio)>> {
    let audio = denoise::denoise(audio)?;
    let samples = audio.samples();
    let probabilities = vad::speech_probabilities(samples)?;
    Ok(
        split::clips(&probabilities, vad::FRAME, samples.len(), max_clip_secs)
            .into_iter()
            .map(|range| {
                (
                    range.start as f64 / f64::from(SAMPLE_RATE),
                    Audio::from_mono_16k(samples[range].to_vec()),
                )
            })
            .collect(),
    )
}
