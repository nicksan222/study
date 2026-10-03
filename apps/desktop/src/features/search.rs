//! The small rules the search palette follows: which section a result goes under, and
//! which part of a long passage a row shows.

use std::ops::Range;
use study_app::views::{SearchHit, SearchKind};
use study_core::text::{collapse_whitespace, truncate_chars};

/// A section of the palette, in the order they are shown.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Group {
    /// Matching projects.
    Projects,
    /// Matching sessions.
    Sessions,
    /// Files found by their name.
    Files,
    /// Files found by what Study read from them.
    Passages,
    /// Text written in a session's messages.
    Messages,
}

impl Group {
    const ORDER: [Group; 5] = [
        Group::Projects,
        Group::Sessions,
        Group::Files,
        Group::Passages,
        Group::Messages,
    ];

    /// The section `hit` is listed under.
    pub fn of(hit: &SearchHit) -> Self {
        match hit.kind {
            SearchKind::Project => Group::Projects,
            SearchKind::Session => Group::Sessions,
            SearchKind::Message => Group::Messages,
            SearchKind::Source if hit.excerpt.is_some() => Group::Passages,
            SearchKind::Source => Group::Files,
        }
    }
}

/// The non-empty sections for `hits`, each with the indexes of its hits in their order.
pub fn grouped(hits: &[SearchHit]) -> Vec<(Group, Vec<usize>)> {
    Group::ORDER
        .into_iter()
        .filter_map(|group| {
            let rows: Vec<usize> = (0..hits.len())
                .filter(|&index| Group::of(&hits[index]) == group)
                .collect();
            (!rows.is_empty()).then_some((group, rows))
        })
        .collect()
}

/// Characters shown before the first match, so it reads in context.
const LEAD: usize = 40;
/// Most characters an excerpt keeps.
const MAX_CHARS: usize = 220;

/// A passage on one line, starting just before the first word of `query` it contains, with
/// the byte ranges of every such word to highlight. A passage found only by meaning starts
/// at its beginning.
pub fn snippet(text: &str, query: &str) -> (String, Vec<Range<usize>>) {
    let line = collapse_whitespace(text);
    let words: Vec<&str> = query
        .split_whitespace()
        // A single letter would light up half the passage.
        .filter(|word| word.chars().count() >= 2)
        .collect();
    let first = words
        .iter()
        .filter_map(|word| find_ignoring_case(&line, word, 0).map(|range| range.start))
        .min();

    let start = match first {
        Some(first) if line[..first].chars().count() > LEAD => {
            let from = line[..first]
                .char_indices()
                .rev()
                .nth(LEAD - 1)
                .map_or(0, |(index, _)| index);
            // Start on a word, not in the middle of one.
            line[from..first]
                .find(' ')
                .map_or(from, |space| from + space + 1)
        }
        _ => 0,
    };
    let mut shown = String::new();
    if start > 0 {
        shown.push('…');
    }
    let rest = &line[start..];
    let cut = truncate_chars(rest, MAX_CHARS);
    if cut.len() < rest.len() {
        shown.push_str(cut.trim_end());
        shown.push('…');
    } else {
        shown.push_str(rest);
    }

    let mut ranges: Vec<Range<usize>> = words
        .iter()
        .flat_map(|word| {
            let mut found = Vec::new();
            let mut from = 0;
            while let Some(range) = find_ignoring_case(&shown, word, from) {
                from = range.end;
                found.push(range);
            }
            found
        })
        .collect();
    ranges.sort_by_key(|range| range.start);
    // Overlapping words, such as "cell" in "cells", highlight once.
    ranges.dedup_by(|next, kept| {
        if next.start < kept.end {
            kept.end = kept.end.max(next.end);
            true
        } else {
            false
        }
    });
    (shown, ranges)
}

/// Where `needle` first occurs in `haystack` at or after byte `from`, ignoring case.
fn find_ignoring_case(haystack: &str, needle: &str, from: usize) -> Option<Range<usize>> {
    haystack[from..].char_indices().find_map(|(offset, _)| {
        let start = from + offset;
        let mut rest = haystack[start..].char_indices();
        for wanted in needle.chars() {
            let (_, got) = rest.next()?;
            if !got.to_lowercase().eq(wanted.to_lowercase()) {
                return None;
            }
        }
        let end = rest
            .next()
            .map_or(haystack.len(), |(index, _)| start + index);
        Some(start..end)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_app::views::SearchTarget;
    use study_core::{ProjectId, SourceId};

    fn hit(kind: SearchKind, excerpt: Option<&str>) -> SearchHit {
        SearchHit {
            kind,
            title: "x".into(),
            context: None,
            excerpt: excerpt.map(Into::into),
            file_kind: None,
            at: 0,
            target: match kind {
                SearchKind::Source => SearchTarget::Source {
                    source_id: SourceId::new(1),
                    anchor: None,
                    session_id: None,
                },
                _ => SearchTarget::Project(ProjectId::new(1)),
            },
        }
    }

    #[test]
    fn results_are_grouped_in_a_fixed_order_keeping_their_rank() {
        let hits = [
            hit(SearchKind::Message, Some("hi")),
            hit(SearchKind::Source, Some("passage")),
            hit(SearchKind::Source, None),
            hit(SearchKind::Project, None),
            hit(SearchKind::Source, Some("another")),
        ];
        assert_eq!(
            grouped(&hits),
            [
                (Group::Projects, vec![3]),
                (Group::Files, vec![2]),
                (Group::Passages, vec![1, 4]),
                (Group::Messages, vec![0]),
            ]
        );
    }

    #[test]
    fn a_passage_fits_on_one_line_with_its_words_marked() {
        let (shown, ranges) = snippet("  Krebs\n\ncycle \t makes ATP ", "atp krebs");
        assert_eq!(shown, "Krebs cycle makes ATP");
        let marked: Vec<&str> = ranges.iter().map(|range| &shown[range.clone()]).collect();
        assert_eq!(marked, ["Krebs", "ATP"]);
    }

    #[test]
    fn a_long_passage_starts_near_its_first_match() {
        let text = format!(
            "{} mitochondria make energy",
            "filler words here ".repeat(10)
        );
        let (shown, ranges) = snippet(&text, "Mitochondria");
        assert!(shown.starts_with('…'));
        assert!(shown.chars().count() < text.chars().count());
        assert_eq!(&shown[ranges[0].clone()], "mitochondria");
        assert!(shown.ends_with("make energy"));
    }

    #[test]
    fn a_passage_found_by_meaning_starts_at_its_beginning_and_is_cut_short() {
        let text = "word ".repeat(100);
        let (shown, ranges) = snippet(&text, "energy");
        assert!(shown.starts_with("word"));
        assert!(shown.ends_with('…'));
        assert!(ranges.is_empty());
    }

    #[test]
    fn case_folding_keeps_byte_ranges_on_the_shown_text() {
        let (shown, ranges) = snippet("Città di Roma", "CITTÀ");
        assert_eq!(&shown[ranges[0].clone()], "Città");
    }
}
