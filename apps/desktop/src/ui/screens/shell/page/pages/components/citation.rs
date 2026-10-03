//! A citation's number as a small chip, as prose sets it among its words; a cited passage
//! as a source row: its number, the source's title and where the passage is, opening it over
//! the page, its number washing in the highlighter while it is hovered (the passage it opens
//! is washed to match, in `source_peek.rs`); and where a source's text starts showing when a
//! citation opened it.

use crate::ui::screens::shell::page::*;
use gpui_kit::Window;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    AnyElement, App, Div, ElementId, FontWeight, InteractiveElement as _, SharedString,
    StatefulInteractiveElement as _,
};
use study_app::views::{Anchor, Block, Citation};
use study_core::SourceId;
use study_localization::{anchor_label, citation_label};
use study_ui::units;

/// What accessibility calls a citation's chip or card: its marker, source and place.
fn label(citation: &Citation, locale: Locale) -> SharedString {
    citation_label(
        locale,
        citation.marker,
        &citation.source_name,
        &citation.anchor,
    )
    .into()
}

/// How a chip opens its passage: the source, its name, and the place.
pub(in crate::ui::screens::shell::page) type OpenCited =
    fn(&mut AppShell, SourceId, String, Anchor, &mut Window, &mut Context<AppShell>);

/// The group a citation's chip is, so its marker washes while it is hovered.
const CITATION: &str = "citation";

/// A citation's number as a small chip, as DESIGN.md's citation is drawn: the digits alone in
/// caption size and the secondary ink, on the selected tone, small radius, 16 tall and 4 to
/// each side. Prose raises it off the line as a superscript; a source row sets it before
/// the source's name.
pub(in crate::ui::screens::shell::page) fn citation_mark(number: u32, cx: &App) -> Div {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    div()
        .flex_none()
        .h(unit(16.))
        .px(unit(study_ui::scale::SPACE_XXS))
        .flex()
        .items_center()
        .justify_center()
        .rounded(unit(study_ui::scale::RADIUS_SM))
        .bg(palette.active)
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .line_height(unit(16.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(palette.muted)
        .child(number.to_string())
}

/// A citation's [`citation_mark`]; it fills with the highlighter wash while the chip it
/// leads is hovered, so the citation lights up as its passage does where it opens.
fn marker(citation: &Citation, cx: &App) -> Div {
    let palette = study_ui::palette(cx);
    let gone = citation.source_id.is_none();
    citation_mark(citation.marker, cx).when(!gone, |marker| {
        marker.group_hover(CITATION, move |style| {
            style
                .bg(palette.highlighter_wash)
                .text_color(palette.foreground)
        })
    })
}

/// What a source row calls a cited source and where in it the passage is: its title, and
/// the moment, page or line; a web page's place is its site. A source named only by its
/// address is called by its site instead, never the raw address.
fn source_words(citation: &Citation, locale: Locale) -> (String, Option<String>) {
    let site = crate::features::media::site;
    let place = match &citation.anchor {
        Anchor::Url { url, .. } => site(url),
        other => anchor_label(locale, other),
    };
    let name = citation.source_name.trim();
    if let Some(name) = crate::features::media::site_of_address(name) {
        // The site already names it: no need to say it twice.
        let place = place.filter(|place| *place != name);
        return (name, place);
    }
    (name.to_owned(), place)
}

/// A chip naming `citation`'s source and place after its marker, which opens the passage
/// with `open` (such as [`AppShell::peek_source`], over the page); a deleted source's chip
/// still says where the passage came from, but opens nothing.
pub(in crate::ui::screens::shell::page) fn citation_chip(
    id: impl Into<ElementId>,
    citation: &Citation,
    open: OpenCited,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let (name, place) = source_words(citation, locale);
    let content = div()
        .max_w(unit(360.))
        .h(unit(26.))
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XS))
        .pl(unit(study_ui::scale::SPACE_XXS))
        .pr(unit(study_ui::scale::SPACE_XS))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(palette.foreground)
        .child(marker(citation, cx))
        .child(
            div()
                .min_w_0()
                .text_ellipsis()
                .whitespace_nowrap()
                .child(SharedString::from(name)),
        )
        .when_some(place, |chip, place| {
            chip.child(
                div()
                    .flex_none()
                    .text_color(palette.faint)
                    .child(SharedString::from(place)),
            )
        });
    match citation.source_id {
        // A button, so the keyboard reaches it in reading order and draws its focus ring.
        Some(source) => {
            let (name, anchor) = (citation.source_name.clone(), citation.anchor.clone());
            Button::new(id)
                .ghost()
                .compact()
                .h_auto()
                .p(unit(0.))
                .rounded(unit(study_ui::scale::RADIUS_SM))
                .tab_stop(true)
                .accessibility_label(label(citation, locale))
                .group(CITATION)
                .child(content)
                .on_click(cx.listener(move |this, _, window, cx| {
                    open(this, source, name.clone(), anchor.clone(), window, cx)
                }))
                .into_any_element()
        }
        None => div()
            .id(id)
            .test_support()
            .aria_label(label(citation, locale))
            .child(content.text_color(palette.faint))
            .into_any_element(),
    }
}

/// The places of the blocks `cited` points at: every non-empty block it overlaps. A moment
/// of a recording (a [`Anchor::Time`]) that falls in a pause between blocks points at the
/// nearest one instead: the first starting after it, else the last before it. Empty when
/// nothing is cited.
pub(in crate::ui::screens::shell::page) fn cited_blocks(
    blocks: &[Block],
    cited: Option<&Anchor>,
) -> Vec<usize> {
    let Some(cited) = cited else {
        return Vec::new();
    };
    let said = || {
        blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| !block.text.trim().is_empty())
    };
    let overlapping: Vec<usize> = said()
        .filter(|(_, block)| block.anchor.overlaps(cited))
        .map(|(ordinal, _)| ordinal)
        .collect();
    if !overlapping.is_empty() {
        return overlapping;
    }
    let &Anchor::Time {
        start_ms: moment, ..
    } = cited
    else {
        return Vec::new();
    };
    let start = |block: &Block| match block.anchor {
        Anchor::Time { start_ms, .. } => Some(start_ms),
        _ => None,
    };
    let after = said().find(|(_, block)| start(block).is_some_and(|start| start >= moment));
    let before = || {
        said()
            .rev()
            .find(|(_, block)| start(block).is_some_and(|start| start < moment))
    };
    after
        .or_else(before)
        .map(|(ordinal, _)| vec![ordinal])
        .unwrap_or_default()
}

/// Where a file's blocks start showing when a citation of `cited` opened it: just before
/// the first block it points at ([`cited_blocks`]), so the passage reads in its context;
/// `None` when no block is cited, and the blocks show from the top.
pub(in crate::ui::screens::shell::page) fn cited_start(
    blocks: &[Block],
    cited: Option<&Anchor>,
) -> Option<usize> {
    let first = *cited_blocks(blocks, cited).first()?;
    Some(first.saturating_sub(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_app::views::BlockKind;

    fn block(start_ms: u64, text: &str) -> Block {
        Block {
            kind: BlockKind::Segment,
            text: text.to_owned(),
            anchor: Anchor::Time {
                start_ms,
                end_ms: start_ms + 10_000,
            },
        }
    }

    #[test]
    fn a_citation_shows_its_passage_with_the_block_before_it() {
        let blocks: Vec<Block> = (0..10).map(|n| block(n * 10_000, "words")).collect();
        let cited = Anchor::Time {
            start_ms: 50_000,
            end_ms: 70_000,
        };
        assert_eq!(cited_start(&blocks, Some(&cited)), Some(4));
        assert_eq!(cited_start(&blocks, None), None);
        let elsewhere = Anchor::Page { page: 1 };
        assert_eq!(cited_start(&blocks, Some(&elsewhere)), None);
    }

    /// A moment in a pause between blocks opens at the next block, or the last one when
    /// it comes after them all, and marks just that block.
    #[test]
    fn a_moment_in_a_pause_points_at_the_nearest_block() {
        // Blocks at 0-10 s, 30-40 s, and an empty one at 50-60 s.
        let blocks = vec![
            block(0, "first"),
            block(30_000, "second"),
            block(50_000, " "),
        ];
        let moment = |ms| Anchor::Time {
            start_ms: ms,
            end_ms: ms + 1,
        };
        assert_eq!(cited_blocks(&blocks, Some(&moment(5_000))), [0]);
        assert_eq!(cited_blocks(&blocks, Some(&moment(20_000))), [1]);
        assert_eq!(cited_start(&blocks, Some(&moment(20_000))), Some(0));
        assert_eq!(cited_blocks(&blocks, Some(&moment(45_000))), [1]);
        assert_eq!(cited_blocks(&blocks, Some(&moment(90_000))), [1]);
        assert!(cited_blocks(&blocks, None).is_empty());
        assert!(cited_blocks(&blocks, Some(&Anchor::Page { page: 1 })).is_empty());
    }
}
