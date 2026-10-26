//! RNNoise, through `nnnoiseless`: a recurrent network of about 90 000 weights, compiled into
//! Study, that takes steady background noise (fans, hum, traffic, a room's hiss) out of
//! speech at hundreds of times real time.
//!
//! Enhancement also leaves faint artifacts, and modern speech models are trained on noisy
//! audio, so cleaning an already clean lecture only costs accuracy. Recordings are cleaned
//! only when their estimated signal-to-noise ratio is below [`NOISY_BELOW_DB`].

use nnnoiseless::DenoiseState;
use study_media::audio::{Audio, SAMPLE_RATE, resample};

use crate::stt::error::Result;

/// The only rate RNNoise reads.
const MODEL_RATE: u32 = 48_000;
/// Recordings with less speech-to-noise margin than this are cleaned.
pub(super) const NOISY_BELOW_DB: f32 = 15.0;
/// Frames of 30 ms at 16 kHz, for estimating levels.
const LEVEL_FRAME: usize = SAMPLE_RATE as usize * 3 / 100;
/// RNNoise works in 16-bit sample units.
const I16_SCALE: f32 = 32_768.0;

/// `audio` with its background noise removed when it is noisy; otherwise unchanged.
/// CPU-bound: call from a blocking context.
pub(super) fn denoise(audio: Audio) -> Result<Audio> {
    match snr_db(audio.samples()) {
        Some(snr) if snr < NOISY_BELOW_DB => {
            tracing::debug!(snr_db = snr, "denoising a noisy recording");
            let len = audio.samples().len();
            let upsampled = resample(audio.samples().to_vec(), SAMPLE_RATE, MODEL_RATE)?;
            let mut cleaned = resample(rnnoise(&upsampled), MODEL_RATE, SAMPLE_RATE)?;
            cleaned.resize(len, 0.0);
            Ok(Audio::from_mono_16k(cleaned))
        }
        _ => Ok(audio),
    }
}

/// Runs RNNoise over 48 kHz samples in `[-1, 1]`, returning as many samples, aligned.
fn rnnoise(samples: &[f32]) -> Vec<f32> {
    let frame = DenoiseState::FRAME_SIZE;
    let mut state = DenoiseState::new();
    let mut input = vec![0.0_f32; frame];
    let mut output = vec![0.0_f32; frame];
    let mut cleaned = Vec::with_capacity(samples.len() + 2 * frame);
    // One extra silent frame flushes the frame of delay RNNoise's overlap-add adds.
    for chunk in samples.chunks(frame).chain(std::iter::once(&[][..])) {
        for (slot, sample) in input
            .iter_mut()
            .zip(chunk.iter().chain(std::iter::repeat(&0.0)))
        {
            *slot = sample * I16_SCALE;
        }
        state.process_frame(&mut output, &input);
        cleaned.extend(output.iter().map(|s| (s / I16_SCALE).clamp(-1.0, 1.0)));
    }
    cleaned.drain(..frame);
    cleaned.truncate(samples.len());
    cleaned
}

/// The ratio in decibels between speech (the loudest tenth of frames) and the noise floor
/// (the quietest tenth). `None` when the floor is digital silence, or too little audio.
pub(super) fn snr_db(samples: &[f32]) -> Option<f32> {
    let mut powers: Vec<f32> = samples
        .as_chunks::<LEVEL_FRAME>()
        .0
        .iter()
        .map(|frame| frame.iter().map(|s| s * s).sum::<f32>() / LEVEL_FRAME as f32)
        .collect();
    let tenth = powers.len() / 10;
    if tenth == 0 {
        return None;
    }
    powers.sort_by(f32::total_cmp);
    let mean = |frames: &[f32]| frames.iter().sum::<f32>() / frames.len() as f32;
    let noise = mean(&powers[..tenth]);
    let speech = mean(&powers[powers.len() - tenth..]);
    (noise > 1e-10).then(|| 10.0 * (speech / noise).log10())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32) -> Vec<f32> {
        (0..(secs * SAMPLE_RATE as f32) as usize)
            .map(|i| {
                (i as f32 * 2.0 * std::f32::consts::PI * 220.0 / SAMPLE_RATE as f32).sin() * 0.5
            })
            .collect()
    }

    /// Deterministic white noise in `[-amplitude, amplitude]`.
    fn noise(len: usize, amplitude: f32) -> Vec<f32> {
        let mut seed = 0x2545_f491_u32;
        (0..len)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 * 2.0 - 1.0) * amplitude
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn clean_audio_is_left_alone() {
        let mut samples = tone(1.0);
        samples.extend(noise(SAMPLE_RATE as usize, 0.0005));
        assert!(snr_db(&samples).unwrap() > NOISY_BELOW_DB);

        let audio = Audio::from_mono_16k(samples.clone());
        assert_eq!(denoise(audio).unwrap().samples(), samples);
    }

    #[test]
    fn digital_silence_is_not_noise() {
        assert_eq!(snr_db(&vec![0.0; SAMPLE_RATE as usize]), None);
        assert_eq!(snr_db(&[0.1; 10]), None);
    }

    #[test]
    fn noise_in_pauses_is_turned_down() {
        let len = SAMPLE_RATE as usize * 2;
        let mut samples = tone(1.0);
        samples.extend(vec![0.0; SAMPLE_RATE as usize]);
        for (sample, n) in samples.iter_mut().zip(noise(len, 0.2)) {
            *sample += n;
        }
        assert!(snr_db(&samples).unwrap() < NOISY_BELOW_DB);

        let cleaned = denoise(Audio::from_mono_16k(samples.clone())).unwrap();

        assert_eq!(cleaned.samples().len(), len);
        let pause = SAMPLE_RATE as usize + 1600..len;
        let before = rms(&samples[pause.clone()]);
        let after = rms(&cleaned.samples()[pause]);
        assert!(after < before / 3.0, "noise went from {before} to {after}");
    }
}
