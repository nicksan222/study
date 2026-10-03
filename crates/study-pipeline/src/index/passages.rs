//! A document as search passages: consecutive blocks packed up to [`MAX_CHARS`], never across
//! a page or slide, each keeping the anchor it spans.

use study_core::Document;
use study_core::db::ChunkDraft;

use super::chunk::{MAX_CHARS, chunk};

/// The passages of `document`, in order. A block longer than a passage is split, and every
/// piece keeps that block's anchor.
pub(crate) fn passages(document: &Document) -> Vec<ChunkDraft> {
    let mut passages: Vec<ChunkDraft> = Vec::new();
    let mut current: Option<ChunkDraft> = None;
    for (index, block) in document.blocks.iter().enumerate() {
        let index = index as u32;
        let text = block.text.trim();
        if text.is_empty() {
            continue;
        }
        let size = text.chars().count();
        if size > MAX_CHARS {
            passages.extend(current.take());
            passages.extend(chunk(text).into_iter().map(|text| ChunkDraft {
                first_block: index,
                last_block: index,
                anchor: block.anchor.clone(),
                text,
            }));
            continue;
        }
        if let Some(open) = &mut current {
            let fits = open.text.chars().count() + 2 + size <= MAX_CHARS;
            if fits && open.anchor.continues_into(&block.anchor) {
                open.text.push_str("\n\n");
                open.text.push_str(text);
                open.last_block = index;
                open.anchor = open.anchor.through(&block.anchor);
                continue;
            }
            passages.extend(current.take());
        }
        current = Some(ChunkDraft {
            first_block: index,
            last_block: index,
            anchor: block.anchor.clone(),
            text: text.to_owned(),
        });
    }
    passages.extend(current);
    passages
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::{Anchor, Block, BlockKind};

    fn document(blocks: Vec<(&str, Anchor)>) -> Document {
        Document {
            blocks: blocks
                .into_iter()
                .map(|(text, anchor)| Block {
                    kind: BlockKind::Paragraph,
                    text: text.into(),
                    anchor,
                })
                .collect(),
            ..Document::default()
        }
    }

    fn time(start_ms: u64, end_ms: u64) -> Anchor {
        Anchor::Time { start_ms, end_ms }
    }

    #[test]
    fn short_segments_are_packed_and_span_their_times() {
        let passages = passages(&document(vec![
            ("one", time(0, 1_000)),
            ("two", time(1_000, 2_000)),
            (" ", time(2_000, 3_000)),
        ]));
        assert_eq!(passages.len(), 1);
        assert_eq!(passages[0].text, "one\n\ntwo");
        assert_eq!((passages[0].first_block, passages[0].last_block), (0, 1));
        assert_eq!(passages[0].anchor, time(0, 2_000));
    }

    #[test]
    fn a_passage_never_crosses_a_page() {
        let passages = passages(&document(vec![
            ("first page", Anchor::Page { page: 1 }),
            ("second page", Anchor::Page { page: 2 }),
        ]));
        let pages: Vec<_> = passages
            .iter()
            .map(|passage| passage.anchor.clone())
            .collect();
        assert_eq!(pages, [Anchor::Page { page: 1 }, Anchor::Page { page: 2 }]);
    }

    #[test]
    fn a_long_block_is_split_and_every_piece_keeps_its_anchor() {
        let long = "A sentence about cells. ".repeat(80);
        let passages = passages(&document(vec![
            ("before", Anchor::Page { page: 1 }),
            (&long, Anchor::Page { page: 1 }),
        ]));
        assert!(passages.len() > 2);
        assert_eq!(passages[0].text, "before");
        assert!(passages[1..].iter().all(|passage| passage.first_block == 1
            && passage.anchor == Anchor::Page { page: 1 }
            && passage.text.chars().count() <= MAX_CHARS));
    }
}
