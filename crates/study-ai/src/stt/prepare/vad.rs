//! Silero VAD v6.2 (MIT, 2.3 MB): the chance each 32 ms frame holds speech.
//!
//! The model is compiled into Study, so every provider gets speech detection with nothing to
//! install. It is fast enough (well over a thousand times real time on one core) to run on
//! every recording before transcription.

use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;
use study_media::audio::SAMPLE_RATE;

use crate::stt::error::Result;

/// `silero_vad.onnx` from snakers4/silero-vad at commit `bfdc0193` ("add v6.2 model").
static MODEL: &[u8] = include_bytes!("../../../models/silero_vad.onnx");

/// Samples the model judges at a time: 32 ms at 16 kHz.
pub(super) const FRAME: usize = 512;
/// Samples of the previous frame the model sees in front of each one.
const CONTEXT: usize = 64;
/// Size of the recurrent state carried from frame to frame.
const STATE: usize = 2 * 128;

/// The speech probability of each [`FRAME`] of 16 kHz `samples`, the last one zero-padded.
/// CPU-bound: call from a blocking context.
pub(super) fn speech_probabilities(samples: &[f32]) -> Result<Vec<f32>> {
    let mut session = session()?;
    let mut state = vec![0.0_f32; STATE];
    let mut window = vec![0.0_f32; CONTEXT + FRAME];
    let mut probabilities = Vec::with_capacity(samples.len().div_ceil(FRAME));
    for frame in samples.chunks(FRAME) {
        // The last frame's tail becomes the next frame's context.
        window.copy_within(FRAME.., 0);
        window[CONTEXT..CONTEXT + frame.len()].copy_from_slice(frame);
        window[CONTEXT + frame.len()..].fill(0.0);

        let outputs = session
            .run(ort::inputs![
                "input" => Tensor::from_array(([1, CONTEXT + FRAME], window.clone())).map_err(model)?,
                "state" => Tensor::from_array(([2, 1, 128], state)).map_err(model)?,
                "sr" => Tensor::from_array(([1], vec![i64::from(SAMPLE_RATE)])).map_err(model)?,
            ])
            .map_err(model)?;
        let (_, probability) = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(model)?;
        probabilities.push(probability.first().copied().unwrap_or(0.0));
        let (_, next) = outputs["stateN"]
            .try_extract_tensor::<f32>()
            .map_err(model)?;
        state = next.to_vec();
    }
    Ok(probabilities)
}

/// A fresh session: the model is small enough that loading it per recording costs a few
/// milliseconds, and no state is shared between recordings.
fn session() -> Result<Session> {
    Session::builder()
        .map_err(model)?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| model(ort::Error::<()>::from(e)))?
        .with_intra_threads(1)
        .map_err(|e| model(ort::Error::<()>::from(e)))?
        .commit_from_memory(MODEL)
        .map_err(model)
}

fn model(error: impl std::fmt::Display) -> crate::stt::Error {
    crate::Error::Model(format!("voice activity detection: {error}")).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "And so, my fellow Americans", two seconds of real speech.
    fn speech() -> Vec<f32> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../study-media/tests/fixtures/jfk_2s.wav"
        );
        study_media::audio::Audio::load(std::path::Path::new(path).into())
            .unwrap()
            .samples()
            .to_vec()
    }

    #[test]
    fn the_model_speaks_the_expected_interface() {
        let session = session().unwrap();
        let inputs: Vec<&str> = session.inputs().iter().map(|i| i.name()).collect();
        let outputs: Vec<&str> = session.outputs().iter().map(|o| o.name()).collect();
        assert_eq!(inputs, ["input", "state", "sr"]);
        assert_eq!(outputs, ["output", "stateN"]);
    }

    #[test]
    fn speech_is_told_apart_from_silence() {
        let mut samples = vec![0.0; SAMPLE_RATE as usize];
        samples.extend(speech());
        samples.extend(vec![0.0; SAMPLE_RATE as usize]);

        let probabilities = speech_probabilities(&samples).unwrap();

        assert_eq!(probabilities.len(), samples.len().div_ceil(FRAME));
        let second = SAMPLE_RATE as usize / FRAME;
        let silent = &probabilities[..second - 1];
        let spoken = &probabilities[second + 3..3 * second - 3];
        assert!(silent.iter().all(|p| *p < 0.2), "{silent:?}");
        let mean = spoken.iter().sum::<f32>() / spoken.len() as f32;
        assert!(mean > 0.7, "{spoken:?}");
    }
}
