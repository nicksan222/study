//! The one canonical text of a source. Every extractor produces a [`Document`]: ordered
//! [`Block`]s of text, each with the [`Anchor`] that says where in the source it came from, so
//! search results, citations and flashcards can point back to a page or a moment.
//!
//! To add an anchor, add the variant to [`Anchor`] and decide it in [`Anchor::through`],
//! [`Anchor::continues_into`] and [`Anchor::overlaps`]; all three matches are exhaustive, so
//! the compiler stops you until you do.

use serde::{Deserialize, Serialize};

use crate::processing::{ExtractorKind, RefinerKind};

crate::text_enum! {
    /// What a block is, for rendering and chunking.
    pub enum BlockKind {
        Paragraph = "paragraph",
        Heading = "heading",
        ListItem = "list_item",
        Table = "table",
        Code = "code",
        /// A stretch of speech.
        Segment = "segment",
    }
}

/// Where a block sits in its source.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Anchor {
    /// A stretch of a recording, in milliseconds from its start.
    Time { start_ms: u64, end_ms: u64 },
    /// A page of a PDF or image, counted from 1.
    Page { page: u32 },
    /// Lines of a text file, counted from 1, and the byte range they cover.
    Text {
        line_start: u32,
        line_end: u32,
        start: u32,
        end: u32,
    },
    /// A slide of a deck, counted from 1.
    Slide { index: u32 },
    /// A paragraph of a word-processor document, counted from 1.
    Paragraph { index: u32 },
    /// A web page, and the part of it when known.
    Url {
        url: String,
        fragment: Option<String>,
    },
}

impl Anchor {
    /// The anchor covering both `self` and a later `other` of the same kind, for a chunk
    /// made of several blocks. Only time spans and line ranges widen; every other kind, and
    /// a pair of different kinds, keeps `self`.
    ///
    /// The match is exhaustive over `self`, so a new anchor must decide here.
    pub fn through(&self, other: &Anchor) -> Anchor {
        match (self, other) {
            (Self::Time { start_ms, .. }, Self::Time { end_ms, .. }) => Self::Time {
                start_ms: *start_ms,
                end_ms: *end_ms,
            },
            (
                Self::Text {
                    line_start, start, ..
                },
                Self::Text { line_end, end, .. },
            ) => Self::Text {
                line_start: *line_start,
                line_end: *line_end,
                start: *start,
                end: *end,
            },
            (
                Self::Time { .. }
                | Self::Page { .. }
                | Self::Text { .. }
                | Self::Slide { .. }
                | Self::Paragraph { .. }
                | Self::Url { .. },
                _,
            ) => self.clone(),
        }
    }

    /// Whether `self` and `other` cover any of the same place: overlapping time spans or
    /// line ranges, the same page, slide or paragraph, or the same web page. This is how a
    /// cited passage finds the blocks it came from.
    ///
    /// The match is exhaustive over `self`, so a new anchor must decide here.
    pub fn overlaps(&self, other: &Anchor) -> bool {
        match (self, other) {
            (
                Self::Time { start_ms, end_ms },
                Self::Time {
                    start_ms: other_start,
                    end_ms: other_end,
                },
            ) => start_ms < other_end && other_start < end_ms || start_ms == other_start,
            (
                Self::Text {
                    line_start,
                    line_end,
                    ..
                },
                Self::Text {
                    line_start: other_start,
                    line_end: other_end,
                    ..
                },
            ) => line_start <= other_end && other_start <= line_end,
            (Self::Page { page: a }, Self::Page { page: b }) => a == b,
            (Self::Slide { index: a }, Self::Slide { index: b })
            | (Self::Paragraph { index: a }, Self::Paragraph { index: b }) => a == b,
            (Self::Url { url: a, .. }, Self::Url { url: b, .. }) => a == b,
            (
                Self::Time { .. }
                | Self::Page { .. }
                | Self::Text { .. }
                | Self::Slide { .. }
                | Self::Paragraph { .. }
                | Self::Url { .. },
                _,
            ) => false,
        }
    }

    /// Whether a chunk may run from `self` into `other`: only within one kind, and never
    /// across pages, slides or web pages.
    ///
    /// The match is exhaustive over `self`, so a new anchor must decide here.
    pub fn continues_into(&self, other: &Anchor) -> bool {
        match (self, other) {
            (Self::Page { page: a }, Self::Page { page: b }) => a == b,
            (Self::Slide { index: a }, Self::Slide { index: b }) => a == b,
            (Self::Url { url: a, .. }, Self::Url { url: b, .. }) => a == b,
            (Self::Time { .. }, Self::Time { .. })
            | (Self::Text { .. }, Self::Text { .. })
            | (Self::Paragraph { .. }, Self::Paragraph { .. }) => true,
            (
                Self::Time { .. }
                | Self::Page { .. }
                | Self::Text { .. }
                | Self::Slide { .. }
                | Self::Paragraph { .. }
                | Self::Url { .. },
                _,
            ) => false,
        }
    }
}

/// One piece of a document's text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub kind: BlockKind,
    pub text: String,
    pub anchor: Anchor,
}

/// How a document was made.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentMeta {
    /// The extractor that read the source; `None` for text that was never extracted, such
    /// as samples.
    pub extractor: Option<ExtractorKind>,
    /// Bumped when the extractor's output changes, so stale documents can be read again.
    pub extractor_version: u32,
    /// The provider or model behind it, when there was one.
    pub provider: Option<String>,
    pub duration_ms: Option<u64>,
    pub page_count: Option<u32>,
    /// The refiners that reworked the extractor's output, in the order they ran. A document
    /// is reused for identical bytes only when these match the refiners that run now.
    pub refiners: Vec<Stamp>,
    /// Refiners its plan ran that failed (no sign-in, a rate limit, the network), so it was
    /// stored without them. It is read again for them once what they need is set up, if they
    /// are still switched on. A refiner switched off when it was read is never listed:
    /// switching it on applies to what is read from then on.
    pub waiting_for: Vec<RefinerKind>,
    /// The user corrected some of its text by hand, so it is no longer what the extractor
    /// and refiners above produced. It is never reused for another source's identical bytes.
    pub corrected: bool,
}

/// A refiner that reworked a document, and the version it was at.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    pub refiner: RefinerKind,
    pub version: u32,
}

/// The canonical text of a source.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub blocks: Vec<Block>,
    pub meta: DocumentMeta,
}

impl Document {
    /// All the text, block after block, separated by blank lines.
    pub fn text(&self) -> String {
        self.blocks
            .iter()
            .map(|block| block.text.as_str())
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// Whether no block has any text.
    pub fn is_empty(&self) -> bool {
        self.blocks.iter().all(|block| block.text.trim().is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cited_passage_finds_the_blocks_it_came_from() {
        let time = |start_ms, end_ms| Anchor::Time { start_ms, end_ms };
        let cited = time(60_000, 120_000);
        assert!(time(90_000, 95_000).overlaps(&cited));
        assert!(time(30_000, 61_000).overlaps(&cited));
        assert!(!time(120_000, 130_000).overlaps(&cited));
        assert!(Anchor::Page { page: 3 }.overlaps(&Anchor::Page { page: 3 }));
        assert!(!Anchor::Page { page: 3 }.overlaps(&Anchor::Slide { index: 3 }));
        let lines = |line_start, line_end| Anchor::Text {
            line_start,
            line_end,
            start: 0,
            end: 0,
        };
        assert!(lines(4, 6).overlaps(&lines(6, 9)));
        assert!(!lines(1, 3).overlaps(&lines(4, 9)));
    }

    #[test]
    fn anchors_are_stored_as_tagged_json() {
        let anchor = Anchor::Time {
            start_ms: 1_000,
            end_ms: 2_500,
        };
        let json = serde_json::to_string(&anchor).unwrap();
        assert_eq!(json, r#"{"type":"time","start_ms":1000,"end_ms":2500}"#);
        assert_eq!(serde_json::from_str::<Anchor>(&json).unwrap(), anchor);
    }

    #[test]
    fn chunks_span_times_and_lines_but_not_pages() {
        let first = Anchor::Time {
            start_ms: 0,
            end_ms: 5,
        };
        let last = Anchor::Time {
            start_ms: 5,
            end_ms: 9,
        };
        assert_eq!(
            first.through(&last),
            Anchor::Time {
                start_ms: 0,
                end_ms: 9
            }
        );
        assert!(first.continues_into(&last));
        assert!(!Anchor::Page { page: 1 }.continues_into(&Anchor::Page { page: 2 }));
    }

    #[test]
    fn a_documents_text_skips_empty_blocks() {
        let block = |text: &str| Block {
            kind: BlockKind::Paragraph,
            text: text.into(),
            anchor: Anchor::Page { page: 1 },
        };
        let document = Document {
            blocks: vec![block("one"), block("  "), block("two")],
            meta: DocumentMeta::default(),
        };
        assert_eq!(document.text(), "one\n\ntwo");
        assert!(!document.is_empty());
    }
}
