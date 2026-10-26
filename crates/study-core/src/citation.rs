//! Where an answer's claims come from. A [`Citation`] snapshots the passage it points to, so
//! it still reads correctly after the source is read again or deleted.

use serde::{Deserialize, Serialize};

use crate::{Anchor, SourceId};

/// One numbered reference in a generated text, written `[n]` where it is used.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Citation {
    /// The `n` of `[n]`, counted from 1.
    pub marker: u32,
    /// `None` once the source has been deleted; the name, place and quote stay.
    pub source_id: Option<SourceId>,
    pub source_name: String,
    /// Where in the source the quote comes from.
    pub anchor: Anchor,
    /// The passage the claim rests on.
    pub quote: String,
}

/// The distinct markers `[n]` in `text`, in order of first use, each at most `max`.
pub fn cited_markers(text: &str, max: u32) -> Vec<u32> {
    let mut markers = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        rest = &rest[open + 1..];
        let Some(close) = rest.find(']') else {
            break;
        };
        // Also `[1, 3]` and `[1][3]`: every number inside the brackets counts.
        for number in rest[..close].split([',', ';', ' ']) {
            if let Ok(marker) = number.trim().parse::<u32>()
                && (1..=max).contains(&marker)
                && !markers.contains(&marker)
            {
                markers.push(marker);
            }
        }
        rest = &rest[close + 1..];
    }
    markers
}

/// `text` without its `[n]` markers, for reading it where the sources they count are not
/// shown: as a note, or as what the student said. Only a bracket whose every number is in
/// `cited`, the markers its version has passages for, is a marker: any other, like `a[0]`
/// or `[2024]`, is the text's own. The space before a marker goes with it.
pub fn without_citations(text: &str, cited: &[u32]) -> String {
    renumber_citations(text, cited, &[])
}

/// `text` with its markers renumbered to follow `kept`, the markers it still has passages
/// for, in ascending order: `kept[0]` becomes `[1]`, `kept[1]` becomes `[2]`, and so on. A
/// marker is a bracket whose every number is in `cited`, as in [`without_citations`]; one
/// not kept is removed, with the space before it, and other brackets stay as they are.
pub fn renumber_citations(text: &str, cited: &[u32], kept: &[u32]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let inside = &rest[open + 1..];
        let group = inside.find(']').and_then(|close| {
            let markers = markers_in(&inside[..close])?;
            markers
                .iter()
                .all(|marker| cited.contains(marker))
                .then_some((close, markers))
        });
        let Some((close, markers)) = group else {
            out.push('[');
            rest = inside;
            continue;
        };
        let renumbered: Vec<String> = markers
            .into_iter()
            .filter_map(|marker| kept.iter().position(|&k| k == marker))
            .map(|index| (index + 1).to_string())
            .collect();
        if renumbered.is_empty() {
            out.truncate(out.trim_end_matches(' ').len());
        } else {
            out.push('[');
            out.push_str(&renumbered.join(", "));
            out.push(']');
        }
        rest = &inside[close + 1..];
    }
    out.push_str(rest);
    out
}

/// The numbers of what is between a marker's brackets, such as `1, 3`; `None` when it is
/// not a list of numbers.
fn markers_in(numbers: &str) -> Option<Vec<u32>> {
    let markers: Vec<u32> = numbers
        .split([',', ';', ' '])
        .filter(|number| !number.is_empty())
        .map(|number| {
            number
                .bytes()
                .all(|byte| byte.is_ascii_digit())
                .then(|| number.parse().ok())
                .flatten()
        })
        .collect::<Option<_>>()?;
    (!markers.is_empty()).then_some(markers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_are_removed_with_the_space_before_them() {
        assert_eq!(
            without_citations(
                "Cells divide [1]. Mitosis [1, 2][3] has phases.",
                &[1, 2, 3]
            ),
            "Cells divide. Mitosis has phases."
        );
        assert_eq!(
            without_citations("Keep [this] and [] and a [1", &[1]),
            "Keep [this] and [] and a [1"
        );
    }

    #[test]
    fn only_brackets_of_cited_markers_are_removed() {
        assert_eq!(
            without_citations("ATP [1] results from [2024] and a[0] [1, 7].", &[1]),
            "ATP results from [2024] and a[0] [1, 7]."
        );
        assert_eq!(without_citations("a[0] and [1]", &[]), "a[0] and [1]");
    }

    #[test]
    fn markers_are_renumbered_densely_and_unkept_ones_removed() {
        assert_eq!(
            renumber_citations(
                "ATP forms [2], via the chain [5][2, 9].",
                &[2, 5, 9],
                &[2, 5]
            ),
            "ATP forms [1], via the chain [2][1]."
        );
        assert_eq!(
            renumber_citations("Gone [3]. Kept [4].", &[3, 4], &[4]),
            "Gone. Kept [1]."
        );
        assert_eq!(
            renumber_citations("Keep [this].", &[1], &[1]),
            "Keep [this]."
        );
    }

    #[test]
    fn brackets_that_cite_nothing_are_not_renumbered() {
        assert_eq!(
            renumber_citations("ATP [2] results from [2024] and a[+1].", &[1, 2], &[2]),
            "ATP [1] results from [2024] and a[+1]."
        );
    }

    #[test]
    fn markers_are_read_in_order_once_and_within_range() {
        assert_eq!(
            cited_markers("Cells divide [2]. Mitosis [1, 2][3] has phases [9].", 3),
            [2, 1, 3]
        );
        assert_eq!(
            cited_markers("No sources [here] or [0].", 3),
            Vec::<u32>::new()
        );
        assert_eq!(cited_markers("Unclosed [1", 3), Vec::<u32>::new());
    }
}
