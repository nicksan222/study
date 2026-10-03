//! Streaming conversion of microphone audio to the 16-bit PCM rate recordings are kept at.

/// Converts mono `f32` audio at one rate to 16-bit PCM at another, a block at a time, with
/// no seams between blocks. Each output sample is the mean of the input samples it covers,
/// which is enough filtering for speech; a slower microphone repeats samples instead.
pub(super) struct Downsampler {
    from: u32,
    to: u32,
    /// Progress towards the next output sample, in units where `from` is one output sample.
    phase: u32,
    sum: f32,
    count: u32,
    last: f32,
}

impl Downsampler {
    pub(super) fn new(from: u32, to: u32) -> Self {
        Self {
            from: from.max(1),
            to: to.max(1),
            phase: 0,
            sum: 0.,
            count: 0,
            last: 0.,
        }
    }

    /// Appends the output for `input` to `output`.
    pub(super) fn push(&mut self, input: &[f32], output: &mut Vec<i16>) {
        if self.from == self.to {
            output.extend(input.iter().copied().map(pcm16));
            return;
        }
        for &sample in input {
            self.sum += sample;
            self.count += 1;
            self.phase += self.to;
            while self.phase >= self.from {
                self.phase -= self.from;
                if self.count > 0 {
                    self.last = self.sum / self.count as f32;
                    self.sum = 0.;
                    self.count = 0;
                }
                output.push(pcm16(self.last));
            }
        }
    }
}

fn pcm16(sample: f32) -> i16 {
    (sample.clamp(-1., 1.) * f32::from(i16::MAX)).round() as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frequency: f32, rate: u32, seconds: f32) -> Vec<f32> {
        (0..(rate as f32 * seconds) as usize)
            .map(|i| (i as f32 * frequency * std::f32::consts::TAU / rate as f32).sin() * 0.5)
            .collect()
    }

    fn periods(samples: &[i16]) -> usize {
        samples.windows(2).filter(|w| w[0] < 0 && w[1] >= 0).count()
    }

    /// Converts `input` in uneven blocks, as a microphone delivers it.
    fn convert(from: u32, input: &[f32]) -> Vec<i16> {
        let mut downsampler = Downsampler::new(from, 16_000);
        let mut output = Vec::new();
        for block in input.chunks(441) {
            downsampler.push(block, &mut output);
        }
        output
    }

    #[test]
    fn common_rates_become_16k_without_losing_the_signal() {
        for rate in [48_000, 44_100, 22_050, 16_000, 8_000] {
            let output = convert(rate, &sine(300., rate, 2.));
            assert!(
                (output.len() as i64 - 32_000).abs() <= 1,
                "{rate} Hz gave {} samples",
                output.len()
            );
            assert!(
                (periods(&output) as i64 - 600).abs() <= 2,
                "{rate} Hz changed the pitch"
            );
            let peak = output.iter().map(|s| s.unsigned_abs()).max().unwrap();
            assert!(peak > 15_000, "{rate} Hz lost volume: {peak}");
        }
    }

    #[test]
    fn samples_are_clipped_to_the_pcm_range() {
        let mut output = Vec::new();
        Downsampler::new(16_000, 16_000).push(&[2., -2., 0.], &mut output);
        assert_eq!(output, [i16::MAX, -i16::MAX, 0]);
    }
}
