//! [`clips`]: where the speech is, packed into pieces a provider accepts.
//!
//! Speech is found from the voice activity model's per-frame probabilities with hysteresis,
//! as Silero's own reference does: speech starts above [`START`] and ends only after
//! [`MIN_SILENCE_SECS`] below [`END`]. Each stretch of speech gets [`PAD_SECS`] of margin so
//! no word loses its edges, nearby stretches are packed into one clip up to the provider's
//! limit, and a stretch longer than the limit is cut where the model is least sure anyone is
//! talking.

use std::ops::Range;

use study_media::audio::SAMPLE_RATE;

/// Probability above which a frame starts speech.
const START: f32 = 0.5;
/// Probability below which a frame may end speech.
const END: f32 = 0.35;
/// How long the probability must stay below [`END`] for speech to end.
const MIN_SILENCE_SECS: f64 = 0.3;
/// Shorter bursts are clicks and coughs, not words.
const MIN_SPEECH_SECS: f64 = 0.25;
/// Margin kept around each stretch of speech.
const PAD_SECS: f64 = 0.2;
/// Stretches further apart than this go to separate clips, so long silences are never sent.
const MAX_GAP_SECS: f64 = 2.0;
/// A cut in over-long speech is searched for in the final part of each window.
const SEARCH_FRACTION: f64 = 0.3;

/// Sample ranges of `len` samples to transcribe, in order and not overlapping, each at most
/// `max_secs` long. `probabilities` holds one speech probability per `frame` samples.
/// Empty when nobody speaks.
pub(super) fn clips(
    probabilities: &[f32],
    frame: usize,
    len: usize,
    max_secs: f64,
) -> Vec<Range<usize>> {
    let seconds = |secs: f64| (secs * f64::from(SAMPLE_RATE)) as usize;
    let max_len = seconds(max_secs).max(2 * frame);
    let pad = seconds(PAD_SECS);

    let mut packed: Vec<Range<usize>> = Vec::new();
    for speech in speech(probabilities, frame) {
        let start = speech.start.saturating_sub(pad);
        let end = (speech.end + pad).min(len);
        match packed.last_mut() {
            Some(last)
                if start <= last.end + seconds(MAX_GAP_SECS) && end - last.start <= max_len =>
            {
                last.end = end;
            }
            // Margins of neighbours may overlap; the later one starts where the earlier ends.
            Some(last) => {
                let start = start.max(last.end);
                packed.push(start..end);
            }
            None => packed.push(start..end),
        }
    }
    packed
        .into_iter()
        .flat_map(|range| cut(range, probabilities, frame, max_len))
        .collect()
}

/// Stretches of speech in samples, from frame probabilities.
fn speech(probabilities: &[f32], frame: usize) -> Vec<Range<usize>> {
    let frames = |secs: f64| ((secs * f64::from(SAMPLE_RATE)) as usize).div_ceil(frame);
    let min_silence = frames(MIN_SILENCE_SECS);
    let min_speech = frames(MIN_SPEECH_SECS);

    let mut found = Vec::new();
    let mut start = None;
    let mut quiet_since = None;
    for (index, &probability) in probabilities.iter().enumerate() {
        match start {
            None if probability >= START => start = Some(index),
            None => {}
            Some(_) if probability >= END => quiet_since = None,
            Some(begun) => {
                let quiet = *quiet_since.get_or_insert(index);
                if index + 1 - quiet >= min_silence {
                    found.push(begun..quiet);
                    start = None;
                    quiet_since = None;
                }
            }
        }
    }
    if let Some(begun) = start {
        found.push(begun..quiet_since.unwrap_or(probabilities.len()));
    }
    found
        .into_iter()
        .filter(|frames| frames.len() >= min_speech)
        .map(|frames| frames.start * frame..frames.end * frame)
        .collect()
}

/// Cuts `range` into pieces of at most `max_len`, each at the least speech-like frame near
/// the end of its window.
fn cut(
    range: Range<usize>,
    probabilities: &[f32],
    frame: usize,
    max_len: usize,
) -> Vec<Range<usize>> {
    let mut pieces = Vec::new();
    let mut start = range.start;
    while range.end - start > max_len {
        let window_end = start + max_len;
        let search_start = window_end - (max_len as f64 * SEARCH_FRACTION) as usize;
        let first = search_start.div_ceil(frame);
        let last = (window_end / frame).max(first + 1);
        // `<=` prefers later cuts among equally quiet frames, keeping pieces long.
        let quietest = (first..last)
            .filter(|&index| index < probabilities.len())
            .fold((f32::INFINITY, last - 1), |best, index| {
                if probabilities[index] <= best.0 {
                    (probabilities[index], index)
                } else {
                    best
                }
            })
            .1;
        let at = (quietest * frame + frame / 2).clamp(start + 1, window_end);
        pieces.push(start..at);
        start = at;
    }
    pieces.push(start..range.end);
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME: usize = 512;

    /// Probabilities from `(seconds, probability)` runs.
    fn frames(runs: &[(f64, f32)]) -> Vec<f32> {
        runs.iter()
            .flat_map(|&(secs, p)| {
                let count = secs * f64::from(SAMPLE_RATE) / FRAME as f64;
                std::iter::repeat_n(p, count.round() as usize)
            })
            .collect()
    }

    fn secs(samples: usize) -> f64 {
        samples as f64 / f64::from(SAMPLE_RATE)
    }

    #[test]
    fn silence_gives_nothing_to_transcribe() {
        let probabilities = frames(&[(10.0, 0.02)]);
        assert!(clips(&probabilities, FRAME, probabilities.len() * FRAME, 30.0).is_empty());
    }

    #[test]
    fn speech_is_kept_with_margins_and_long_silences_are_dropped() {
        let probabilities = frames(&[(5.0, 0.0), (3.0, 0.9), (10.0, 0.0), (2.0, 0.9), (5.0, 0.0)]);
        let len = probabilities.len() * FRAME;

        let found = clips(&probabilities, FRAME, len, 30.0);

        assert_eq!(found.len(), 2, "{found:?}");
        assert!(
            (secs(found[0].start) - (5.0 - PAD_SECS)).abs() < 0.1,
            "{found:?}"
        );
        assert!(
            (secs(found[0].end) - (8.0 + PAD_SECS)).abs() < 0.1,
            "{found:?}"
        );
        assert!(
            (secs(found[1].start) - (18.0 - PAD_SECS)).abs() < 0.1,
            "{found:?}"
        );
    }

    #[test]
    fn short_pauses_and_nearby_speech_stay_in_one_clip() {
        let probabilities = frames(&[(1.0, 0.9), (0.2, 0.1), (1.0, 0.9), (1.0, 0.0), (1.0, 0.9)]);
        let found = clips(&probabilities, FRAME, probabilities.len() * FRAME, 30.0);
        assert_eq!(found.len(), 1, "{found:?}");
    }

    #[test]
    fn clicks_are_not_speech() {
        let probabilities = frames(&[(2.0, 0.0), (0.1, 0.99), (2.0, 0.0)]);
        assert!(clips(&probabilities, FRAME, probabilities.len() * FRAME, 30.0).is_empty());
    }

    #[test]
    fn long_speech_is_cut_where_it_is_least_speech_like() {
        // 25 s of speech with a hesitation at 8 s and another at 17 s.
        let probabilities = frames(&[
            (8.0, 0.95),
            (0.1, 0.4),
            (8.9, 0.95),
            (0.1, 0.4),
            (8.0, 0.95),
        ]);
        let len = probabilities.len() * FRAME;

        let found = clips(&probabilities, FRAME, len, 10.0);

        assert_eq!(found.len(), 3, "{found:?}");
        assert!(
            found.iter().all(|r| secs(r.len()) <= 10.0 + 1e-9),
            "{found:?}"
        );
        assert!((secs(found[0].end) - 8.0).abs() < 0.2, "{found:?}");
        assert!((secs(found[1].end) - 17.0).abs() < 0.2, "{found:?}");
        assert!(
            found.windows(2).all(|w| w[0].end == w[1].start),
            "{found:?}"
        );
        assert_eq!(found[2].end, len);
    }

    #[test]
    fn packed_clips_never_exceed_the_limit_or_overlap() {
        let mut runs = Vec::new();
        for _ in 0..20 {
            runs.push((2.5, 0.9));
            runs.push((0.5, 0.0));
        }
        let probabilities = frames(&runs);
        let found = clips(&probabilities, FRAME, probabilities.len() * FRAME, 7.0);

        assert!(found.len() > 5);
        assert!(
            found.iter().all(|r| secs(r.len()) <= 7.0 + 1e-9),
            "{found:?}"
        );
        assert!(
            found.windows(2).all(|w| w[0].end <= w[1].start),
            "{found:?}"
        );
    }
}
