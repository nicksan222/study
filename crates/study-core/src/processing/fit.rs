//! Fitting passages into what a model is shown. Every agent that reads numbered passages
//! (material, answers, practice) measures them the same way: by the characters it is
//! shown, each passage trimmed and cut at [`MAX_PASSAGE_CHARS`].

use super::Excerpt;
use crate::text::truncate_chars;

/// Longest passage a model is shown; the rest of a longer one is cut when it is rendered.
pub const MAX_PASSAGE_CHARS: usize = 1_500;

/// What a model is shown of a passage's `text`: trimmed, and cut at [`MAX_PASSAGE_CHARS`].
pub fn shown_passage(text: &str) -> &str {
    truncate_chars(text.trim(), MAX_PASSAGE_CHARS)
}

impl Excerpt {
    /// How many characters of this passage a model is shown, as [`shown_passage`] cuts it.
    pub fn shown_chars(&self) -> usize {
        shown_passage(&self.text).chars().count()
    }
}

/// The passages of `excerpts` a model is shown within `budget` characters (as
/// [`Excerpt::shown_chars`] counts them), in their order, never over it. All of them when
/// they fit; otherwise those in `preferred` first (matched by source and anchor, taken in
/// its order), then an even spread of the rest, so the end of a long lecture counts as much
/// as its start.
pub fn fit_excerpts(excerpts: Vec<Excerpt>, budget: usize, preferred: &[Excerpt]) -> Vec<Excerpt> {
    let sizes: Vec<usize> = excerpts.iter().map(Excerpt::shown_chars).collect();
    if sizes.iter().sum::<usize>() <= budget {
        return excerpts;
    }
    let mut keep = vec![false; excerpts.len()];
    let mut used = 0;
    let preferred = preferred.iter().filter_map(|wanted| {
        excerpts
            .iter()
            .position(|own| own.source_id == wanted.source_id && own.anchor == wanted.anchor)
    });
    for index in preferred {
        if !keep[index] && used + sizes[index] <= budget {
            keep[index] = true;
            used += sizes[index];
        }
    }
    let rest: Vec<usize> = (0..excerpts.len()).filter(|&index| !keep[index]).collect();
    let rest_size: usize = rest.iter().map(|&index| sizes[index]).sum();
    // Every n-th of the rest, n chosen so the picks about fill what the budget has left.
    let every = rest_size.div_ceil((budget - used).max(1)).max(1);
    for &index in rest.iter().step_by(every) {
        if used + sizes[index] <= budget {
            keep[index] = true;
            used += sizes[index];
        }
    }
    excerpts
        .into_iter()
        .zip(keep)
        .filter_map(|(excerpt, kept)| kept.then_some(excerpt))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Anchor, SourceId};

    fn passage(page: u32, text: String) -> Excerpt {
        Excerpt {
            source_id: SourceId::new(1),
            source_name: "cells.pdf".into(),
            anchor: Anchor::Page { page },
            text,
        }
    }

    fn pages(excerpts: &[Excerpt]) -> Vec<u32> {
        excerpts
            .iter()
            .map(|excerpt| match excerpt.anchor {
                Anchor::Page { page } => page,
                _ => unreachable!(),
            })
            .collect()
    }

    fn shown(excerpts: &[Excerpt]) -> usize {
        excerpts.iter().map(Excerpt::shown_chars).sum()
    }

    #[test]
    fn every_passage_goes_when_they_fit() {
        let excerpts: Vec<_> = (1..=5).map(|page| passage(page, "x".repeat(100))).collect();
        assert_eq!(fit_excerpts(excerpts.clone(), 500, &[]), excerpts);
    }

    #[test]
    fn what_does_not_fit_keeps_the_preferred_then_a_spread_of_the_rest() {
        let excerpts: Vec<_> = (1..=20)
            .map(|page| passage(page, "x".repeat(100)))
            .collect();
        let preferred = [passage(17, String::new())];
        let kept = fit_excerpts(excerpts, 500, &preferred);
        let pages = pages(&kept);
        assert_eq!(kept.len(), 5);
        assert!(pages.contains(&17));
        assert!(pages.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(*pages.last().unwrap() > 10, "{pages:?}");
    }

    #[test]
    fn long_material_is_spread_evenly_and_never_over_the_budget() {
        let excerpts: Vec<_> = (0..100).map(|n| passage(n, format!("{n:0>400}"))).collect();
        let kept = fit_excerpts(excerpts, 16_000, &[]);
        assert!(kept.len() < 100);
        assert!(shown(&kept) <= 16_000);
        assert!(*pages(&kept).last().unwrap() > 95);
    }

    #[test]
    fn passages_count_what_the_model_is_shown() {
        // Surrounding space is not shown, and a long passage is cut, so both fit.
        let excerpts = vec![
            passage(1, format!("  {}  ", "x".repeat(100))),
            passage(2, "é".repeat(10 * MAX_PASSAGE_CHARS)),
        ];
        assert_eq!(excerpts[0].shown_chars(), 100);
        assert_eq!(excerpts[1].shown_chars(), MAX_PASSAGE_CHARS);
        let budget = 100 + MAX_PASSAGE_CHARS;
        assert_eq!(fit_excerpts(excerpts.clone(), budget, &[]), excerpts);
        assert_eq!(pages(&fit_excerpts(excerpts, budget - 1, &[])), [1]);
    }
}
