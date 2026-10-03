//! Band-limited FFT resampling with rubato: to [`SAMPLE_RATE`](super::SAMPLE_RATE) on load,
//! and between any two rates for models that read another one.

use audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

use crate::error::{Error, Result};

/// Frames the resampler processes at a time.
const CHUNK_FRAMES: usize = 1024;

/// Band-limited FFT resampling of mono audio from rate `from` to rate `to`. CPU-bound: call
/// from a blocking context.
pub fn resample(samples: Vec<f32>, from: u32, to: u32) -> Result<Vec<f32>> {
    if from == to || samples.is_empty() {
        return Ok(samples);
    }
    let error = |e: &dyn std::fmt::Display| Error::Decode(format!("resampling failed: {e}"));
    let mut resampler =
        Fft::<f32>::new(from as usize, to as usize, CHUNK_FRAMES, 1, FixedSync::Both)
            .map_err(|e| error(&e))?;
    let input = InterleavedSlice::new(&samples, 1, samples.len()).map_err(|e| error(&e))?;
    let output = resampler
        .process_all(&input, samples.len(), None)
        .map_err(|e| error(&e))?;
    Ok(output.take_data())
}
