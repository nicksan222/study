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

#[cfg(test)]
mod tests {
    use super::*;

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
