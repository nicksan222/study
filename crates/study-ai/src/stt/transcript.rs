//! [`Transcript`]: what transcription returns, and how pieces are joined.

use serde::{Deserialize, Serialize};

/// Text recognized from one audio input, with timings in seconds from its start.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Transcript {
    pub text: String,
    pub segments: Vec<Segment>,
    pub duration_secs: f64,
}

/// A stretch of the text, with when it was said, in seconds from the start.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub start_secs: f64,
    pub end_secs: f64,
    pub text: String,
}

impl Transcript {
    /// A transcript covering the whole clip with one segment.
    pub fn whole(text: impl Into<String>, duration_secs: f64) -> Self {
        let text = text.into().trim().to_owned();
        let segments = if text.is_empty() {
            Vec::new()
        } else {
            vec![Segment {
                start_secs: 0.0,
                end_secs: duration_secs,
                text: text.clone(),
            }]
        };
        Self {
            text,
            segments,
            duration_secs,
        }
    }

    /// Joins transcripts of consecutive pieces, shifting each by its start offset.
    pub fn stitch(parts: impl IntoIterator<Item = (f64, Transcript)>) -> Self {
        let mut stitched = Transcript::default();
        let mut texts = Vec::new();
        for (offset, part) in parts {
            if !part.text.is_empty() {
                texts.push(part.text);
            }
            stitched
                .segments
                .extend(part.segments.into_iter().map(|segment| Segment {
                    start_secs: segment.start_secs + offset,
                    end_secs: segment.end_secs + offset,
                    text: segment.text,
                }));
            stitched.duration_secs = stitched.duration_secs.max(offset + part.duration_secs);
        }
        stitched.text = texts.join(" ");
        stitched
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_trims_text_and_omits_segments_for_silence() {
        let transcript = Transcript::whole("  hello  ", 2.0);
        assert_eq!(transcript.text, "hello");
        assert_eq!(transcript.segments.len(), 1);
        assert_eq!(transcript.segments[0].end_secs, 2.0);
        assert!(Transcript::whole(" ", 1.0).segments.is_empty());
    }

    #[test]
    fn stitch_offsets_segments_and_joins_text() {
        let stitched = Transcript::stitch([
            (0.0, Transcript::whole("first", 10.0)),
            (10.0, Transcript::whole("", 5.0)),
            (15.0, Transcript::whole("second", 4.0)),
        ]);
        assert_eq!(stitched.text, "first second");
        assert_eq!(stitched.duration_secs, 19.0);
        assert_eq!(stitched.segments[1].start_secs, 15.0);
        assert_eq!(stitched.segments[1].end_secs, 19.0);
    }
}
