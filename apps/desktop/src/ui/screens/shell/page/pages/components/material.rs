//! What a piece of study material is called, looks like and says about itself: drawn on
//! a page of material, in a conversation where the agent made it, and in Settings where its
//! kinds are switched.

use super::citation::citation_mark;
use super::code_block;
use crate::features::jobs::{Problem, status_label};
use crate::features::markdown::{Line, Mark, inline};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::{
    AnyElement, App, ElementId, FontStyle, FontWeight, HighlightStyle, Hsla,
    InteractiveElement as _, SharedString, StyledText, Window,
};
use std::ops::Range;
use std::rc::Rc;
use study_app::views::{Artifact, ArtifactKind, ArtifactStatus, JobStatus};
use study_localization::{ago, joined};
use study_ui::units;

/// What a kind of material is called.
pub(in crate::ui::screens::shell::page) fn kind_label(kind: ArtifactKind) -> Message {
    match kind {
        ArtifactKind::Notes => Message::KindNotes,
        ArtifactKind::Flashcards => Message::KindFlashcards,
        ArtifactKind::Diagram => Message::KindDiagram,
    }
}

/// The icon a kind of material is drawn with.
pub(in crate::ui::screens::shell::page) fn kind_icon(kind: ArtifactKind) -> IconName {
    match kind {
        ArtifactKind::Notes => IconName::SquarePen,
        ArtifactKind::Flashcards => IconName::Shapes,
        ArtifactKind::Diagram => IconName::Workflow,
    }
}

/// Whether a piece of material is still on its way: not written, and its job neither
/// waiting for setup, failed nor stopped.
pub(in crate::ui::screens::shell::page) fn material_writing(artifact: &Artifact) -> bool {
    artifact.status != ArtifactStatus::Complete
        && !artifact
            .job
            .as_ref()
            .is_some_and(|job| job.status.is_stopped() || job.status == JobStatus::Waiting)
}

/// How writing a piece of material went, in a word or two, and its colour: the secondary
/// ink, or `danger` when it failed.
pub(in crate::ui::screens::shell::page) fn material_status(
    artifact: &Artifact,
    locale: Locale,
    colors: &gpui_kit::component::ThemeColor,
) -> (SharedString, Hsla) {
    if artifact.status == ArtifactStatus::Complete {
        let when = ago(locale, crate::features::clock::now() - artifact.updated_at);
        return (
            joined(&[text(locale, kind_label(artifact.kind)).to_owned(), when]).into(),
            colors.muted_foreground,
        );
    }
    match artifact.job.as_ref().map(|job| (job, job.status)) {
        Some((job, JobStatus::Failed)) => (
            text(locale, Problem::of_job(job).explanation()).into(),
            colors.danger,
        ),
        Some((job, JobStatus::Waiting)) => (
            text(locale, Problem::of_job(job).explanation()).into(),
            colors.muted_foreground,
        ),
        Some((_, JobStatus::Running)) => (
            text(locale, Message::WritingMaterial).into(),
            colors.muted_foreground,
        ),
        Some((_, status @ (JobStatus::Cancelled | JobStatus::Blocked | JobStatus::Queued))) => (
            text(locale, status_label(status)).into(),
            colors.muted_foreground,
        ),
        _ => (
            text(locale, Message::StatusWaiting).into(),
            colors.muted_foreground,
        ),
    }
}

/// What clicking a citation marker such as `[2]` in [`prose_citing`] does, given its number.
pub(in crate::ui::screens::shell::page) type OnCite = Rc<dyn Fn(u32, &mut Window, &mut App)>;

/// The group a citation chip in prose is, so its mark washes while it is hovered.
const PROSE_CITATION: &str = "prose-citation";

/// Markdown as the model writes it, read comfortably: headings by level, bullet and
/// numbered lists, quotes, code blocks, rules, **bold** picked out, and citation markers like
/// `[2]` as their number alone in a superscript chip ([`citation_mark`]).
pub(in crate::ui::screens::shell::page) fn prose(
    markdown: &str,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    prose_citing(markdown, None, cx)
}

/// [`prose`] whose citation markers open what they cite: each `[n]` a raised chip that
/// calls `cite` with `n`. `id` names the prose among the page's elements.
pub(in crate::ui::screens::shell::page) fn prose_citing(
    markdown: &str,
    cite: Option<(ElementId, OnCite)>,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let palette = study_ui::palette(cx);
    let (id, cite) = cite.unzip();
    let mut column = div().w_full().flex().flex_col().gap(unit(8.));
    // The lines of a code block being read, until its closing fence.
    let mut code: Option<Vec<&str>> = None;
    for (ordinal, raw) in markdown.lines().enumerate() {
        let line = Line::of(raw.trim());
        if let Some(lines) = &mut code {
            if matches!(line, Line::Fence(_)) {
                column = column.child(code_block(&lines.join("\n"), cx));
                code = None;
            } else {
                lines.push(raw);
            }
            continue;
        }
        if matches!(line, Line::Fence(_)) {
            code = Some(Vec::new());
            continue;
        }
        if raw.trim().is_empty() {
            continue;
        }
        let (shown, marks) = inline(line.text());
        let styled = if marks.iter().any(|(_, mark)| *mark == Mark::Citation) {
            cited_words(&shown, &marks, ordinal, cite.as_ref(), cx)
        } else {
            let highlights = marks
                .iter()
                .map(|(range, mark)| (range.clone(), mark_style(*mark)));
            StyledText::new(shown)
                .with_highlights(highlights)
                .into_any_element()
        };
        let words = study_ui::body_text(cx).min_w_0().flex_1().child(styled);
        column = column.child(match line {
            Line::Rule => div()
                .my(unit(6.))
                .h(gpui_kit::px(1.))
                .w_full()
                .bg(colors.border),
            Line::Heading(level, _) => div()
                .mt(unit(if level == 1 {
                    study_ui::scale::SPACE_SM
                } else {
                    study_ui::scale::SPACE_XS
                }))
                .whitespace_normal()
                .font_weight(FontWeight::SEMIBOLD)
                .child(words.text_size(unit(if level == 1 {
                    study_ui::scale::TEXT_TITLE
                } else {
                    study_ui::scale::TEXT_BODY
                }))),
            Line::Bullet(_) => div()
                .flex()
                .gap(unit(10.))
                .pl(unit(4.))
                .child(
                    div()
                        .flex_none()
                        .mt(unit(10.))
                        .size(unit(4.))
                        .rounded_full()
                        .bg(palette.muted),
                )
                .child(words),
            Line::Numbered(marker, _) => div()
                .flex()
                .gap(unit(8.))
                .child(
                    study_ui::body_text(cx)
                        .flex_none()
                        .min_w(unit(18.))
                        .text_color(palette.muted)
                        .child(SharedString::from(marker)),
                )
                .child(words),
            Line::Quote(_) => div()
                .flex()
                .pl(unit(12.))
                .border_l_2()
                .border_color(palette.active)
                .text_color(colors.muted_foreground)
                .child(words),
            Line::Paragraph(_) | Line::Fence(_) => div().flex().child(words),
        });
    }
    // A block of code the model never closed still shows.
    if let Some(lines) = code.filter(|lines| !lines.is_empty()) {
        column = column.child(code_block(&lines.join("\n"), cx));
    }
    match id {
        Some(id) => column.id(id).into_any_element(),
        None => column.into_any_element(),
    }
}

/// How a stretch of words set apart by `mark` looks; a citation is drawn as a chip instead
/// ([`cited_words`]), so it keeps the words' look.
fn mark_style(mark: Mark) -> HighlightStyle {
    match mark {
        Mark::Strong => HighlightStyle {
            font_weight: Some(FontWeight::SEMIBOLD),
            ..HighlightStyle::default()
        },
        Mark::Emphasis => HighlightStyle {
            font_style: Some(FontStyle::Italic),
            ..HighlightStyle::default()
        },
        Mark::Citation => HighlightStyle::default(),
    }
}

/// A piece of a line of prose that carries citations: a word (its range in the line's
/// shown text), or a citation's number.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Piece {
    Word(Range<usize>),
    Cite(u32),
}

/// The line `shown` (with its `marks`) cut into the pieces that wrap together: each word,
/// with the citations right after it and anything written straight after those (a full
/// stop) kept on its line. The space before a citation goes, so its chip sits against the
/// word as a superscript; its brackets go too.
fn wrapping_units(shown: &str, marks: &[(Range<usize>, Mark)]) -> Vec<Vec<Piece>> {
    let mut units: Vec<Vec<Piece>> = Vec::new();
    let words = |range: Range<usize>, units: &mut Vec<Vec<Piece>>| {
        let text = &shown[range.clone()];
        let mut glued = !text.starts_with(char::is_whitespace)
            && units
                .last()
                .is_some_and(|unit| matches!(unit.last(), Some(Piece::Cite(_))));
        let mut start = None;
        for (at, c) in text.char_indices().chain([(text.len(), ' ')]) {
            match (c.is_whitespace(), start) {
                (false, None) => start = Some(at),
                (true, Some(from)) => {
                    let word = Piece::Word(range.start + from..range.start + at);
                    match units.last_mut().filter(|_| glued) {
                        Some(unit) => unit.push(word),
                        None => units.push(vec![word]),
                    }
                    glued = false;
                    start = None;
                }
                _ => {}
            }
        }
    };
    let mut at = 0;
    for (range, mark) in marks {
        if *mark != Mark::Citation {
            continue;
        }
        words(at..range.start, &mut units);
        at = range.end;
        let Ok(number) = shown[range.clone()].trim_matches(['[', ']']).parse() else {
            continue;
        };
        match units.last_mut() {
            Some(unit) => unit.push(Piece::Cite(number)),
            None => units.push(vec![Piece::Cite(number)]),
        }
    }
    words(at..shown.len(), &mut units);
    units
}

/// A line of prose that cites: its words wrapping as text would, each citation's number a
/// [`citation_mark`] raised off the line against the word before it, 2 apart from the next
/// one. With `cite`, a chip opens what it cites and washes in the highlighter while hovered.
fn cited_words(
    shown: &str,
    marks: &[(Range<usize>, Mark)],
    ordinal: usize,
    cite: Option<&OnCite>,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let styled = |range: Range<usize>| {
        // The marks over this word, measured from its start.
        let highlights = marks.iter().filter_map(|(marked, mark)| {
            let start = marked.start.max(range.start);
            let end = marked.end.min(range.end);
            (start < end).then(|| (start - range.start..end - range.start, mark_style(*mark)))
        });
        StyledText::new(shown[range.clone()].to_owned()).with_highlights(highlights)
    };
    let mut line = div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap_x(unit(study_ui::scale::SPACE_XXS));
    let mut chips = 0;
    for pieces in wrapping_units(shown, marks) {
        let mut group = div().flex_none().flex().items_start();
        let mut after_cite = false;
        for piece in pieces {
            group = match piece {
                Piece::Word(range) => {
                    after_cite = false;
                    group.child(styled(range))
                }
                Piece::Cite(number) => {
                    // Raised so its digits sit about 4 above the words' baseline.
                    let (top, left) = (unit(1.), unit(if after_cite { 2. } else { 1. }));
                    after_cite = true;
                    chips += 1;
                    match cite {
                        // A button, so the keyboard reaches it in reading order and draws its
                        // focus ring; it washes while hovered, as the passage does.
                        Some(cite) => {
                            let cite = cite.clone();
                            group.child(
                                // The text variant adds no padding or height of its own, so the
                                // chip stays a tight superscript in the line.
                                Button::new(chips)
                                    .text()
                                    .mt(top)
                                    .ml(left)
                                    .rounded(unit(study_ui::scale::RADIUS_SM))
                                    .tab_stop(true)
                                    .group(PROSE_CITATION)
                                    .child(citation_mark(number, cx).group_hover(
                                        PROSE_CITATION,
                                        move |style| {
                                            style
                                                .bg(palette.highlighter_wash)
                                                .text_color(palette.foreground)
                                        },
                                    ))
                                    .on_click(move |_, window, cx| cite(number, window, cx)),
                            )
                        }
                        None => group.child(citation_mark(number, cx).mt(top).ml(left)),
                    }
                }
            };
        }
        line = line.child(group);
    }
    match cite {
        Some(_) => line.id(ordinal).into_any_element(),
        None => line.into_any_element(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pieces of a line, as text: words as they read, citations as `^n`.
    fn pieces(line: &str) -> Vec<String> {
        let (shown, marks) = inline(line);
        wrapping_units(&shown, &marks)
            .into_iter()
            .map(|unit| {
                unit.into_iter()
                    .map(|piece| match piece {
                        Piece::Word(range) => shown[range].to_owned(),
                        Piece::Cite(number) => format!("^{number}"),
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .collect()
    }

    /// A citation loses its brackets and the space before it, and wraps with the word it
    /// follows and the full stop after it; neighbouring citations stay together.
    #[test]
    fn citations_ride_on_the_word_before_them() {
        assert_eq!(
            pieces("Pompey's wife [1]. Then **civil war** [2][5]; done"),
            ["Pompey's", "wife^1.", "Then", "civil", "war^2^5;", "done"]
        );
        assert_eq!(pieces("[3] opens it"), ["^3", "opens", "it"]);
        assert_eq!(pieces("glued[4] word"), ["glued^4", "word"]);
    }
}
