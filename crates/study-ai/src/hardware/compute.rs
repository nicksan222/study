//! Synthetic kernels for the two limits that decide local inference speed: arithmetic
//! throughput, which decides whether the local models (speech-to-text, search) keep up, and
//! memory bandwidth, shown with the report for what the computer can do.
//!
//! Each kernel is one private function returning its score; [`measure`] runs them all and
//! `fastest` does the timing.
//!
//! To add a kernel, change only this file: add a field to [`ComputeScore`] (unit in its name),
//! write a private kernel timed with `fastest`, and fill the field in [`measure`] — the one
//! place kernels are registered. Any size it needs goes in [`ComputeConfig`]. Then bump `KEY`
//! in `report.rs`; its `saved_shape_matches_the_key` test fails until you do.

use std::hint::black_box;
use std::time::{Duration, Instant};

use candle_core::{Device, Tensor};
use serde::{Deserialize, Serialize};
use study_core::Result;

/// Scores are reported in billions (GFLOP/s, GB/s).
const GIGA: f64 = 1e9;
const BYTES_PER_MIB: usize = 1 << 20;

/// How big and how long each kernel runs. [`Default`] is what the app uses; tests shrink it.
#[derive(Clone, Debug)]
pub struct ComputeConfig {
    /// Side of the square f32 matrices multiplied.
    pub matmul_size: usize,
    /// Size of the buffer copied to measure bandwidth; keep it well above the CPU caches.
    pub memory_mib: usize,
    /// Each kernel repeats until at least this much time has passed.
    pub min_duration: Duration,
}

impl Default for ComputeConfig {
    fn default() -> Self {
        Self {
            matmul_size: 1024,
            memory_mib: 256,
            min_duration: Duration::from_secs(1),
        }
    }
}

/// What the kernels measured. Higher is faster.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ComputeScore {
    /// f32 matrix multiplication on all cores, in billions of floating-point operations per second.
    pub matmul_gflops: f64,
    /// Bytes read plus bytes written per second while copying across all cores, in GB/s.
    pub memory_bandwidth_gbps: f64,
}

/// Runs every kernel: the one place kernels are registered. Blocks for about `min_duration` per
/// kernel; call it off the UI thread.
pub fn measure(config: &ComputeConfig) -> Result<ComputeScore> {
    Ok(ComputeScore {
        matmul_gflops: matmul_gflops(config.matmul_size.max(1), config.min_duration)?,
        memory_bandwidth_gbps: memory_bandwidth_gbps(
            config.memory_mib.max(1) * BYTES_PER_MIB,
            config.min_duration,
        ),
    })
}

/// Multiplies two random `n`×`n` f32 matrices on the CPU.
fn matmul_gflops(n: usize, min_duration: Duration) -> Result<f64> {
    let device = Device::Cpu;
    let a = Tensor::randn(0f32, 1.0, (n, n), &device)?;
    let b = Tensor::randn(0f32, 1.0, (n, n), &device)?;
    // Warm up thread pools and caches.
    black_box(a.matmul(&b)?);

    // Each of the n² outputs takes n multiplications and n additions.
    let flops = 2.0 * (n as f64).powi(3);
    let seconds = fastest(min_duration, || {
        black_box(a.matmul(&b)?);
        Ok(())
    })?;
    Ok(flops / seconds / GIGA)
}

/// Copies a `bytes`-long buffer, split evenly across one thread per core.
fn memory_bandwidth_gbps(bytes: usize, min_duration: Duration) -> f64 {
    let threads = std::thread::available_parallelism().map_or(1, usize::from);
    let source = vec![1u8; bytes];
    let mut target = vec![0u8; bytes];
    let chunk = bytes.div_ceil(threads);
    let copy_all = |target: &mut [u8]| {
        std::thread::scope(|scope| {
            for (from, to) in source.chunks(chunk).zip(target.chunks_mut(chunk)) {
                scope.spawn(move || to.copy_from_slice(black_box(from)));
            }
        });
    };
    // The first pass also faults the target pages in.
    copy_all(&mut target);

    // Copying cannot fail, so `fastest` always returns `Ok`.
    let seconds = fastest(min_duration, || {
        copy_all(&mut target);
        black_box(&target);
        Ok(())
    })
    .unwrap_or(f64::INFINITY);
    // Every byte is read once and written once.
    let bytes_moved = 2.0 * bytes as f64;
    bytes_moved / seconds / GIGA
}

/// Repeats `work` for at least `min_duration` and returns its fastest single run, in seconds.
/// Other programs can only slow a run down, so the fastest one is what the machine can do.
fn fastest(min_duration: Duration, mut work: impl FnMut() -> Result<()>) -> Result<f64> {
    let start = Instant::now();
    let mut best = f64::INFINITY;
    while best.is_infinite() || start.elapsed() < min_duration {
        let run = Instant::now();
        work()?;
        best = best.min(run.elapsed().as_secs_f64());
    }
    // Never zero, so callers can divide by it.
    Ok(best.max(f64::MIN_POSITIVE))
}
