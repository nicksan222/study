//! Mentions in a composer and in the transcript: `@study` shows as a highlighted chip. A
//! finished mention typed in a composer turns into a chip, the ask button inserts one, and a
//! sent note marks each of its own.
//! While one is being typed, a [`MentionPicker`] above the text offers what it could become,
//! picked with the arrow keys and Enter or Tab, or a click.
//!
//! A chip's text is the mention as notes store it ([`Mention::written`]).

use crate::ui::screens::shell::page::pages::components::badge;
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _,
    input::{InlineToken, TextareaState},
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    AnyElement, App, ElementId, Entity, InteractiveElement as _, Role,
    StatefulInteractiveElement as _,
};
use std::ops::Range;
use study_core::Mention;
use study_localization::{mention_label, mention_suggestions};
use study_ui::icon_button;

/// The keys a picker answers to, as GPUI names them.
const UP: &str = "up";
const DOWN: &str = "down";
const ENTER: &str = "enter";
const TAB: &str = "tab";
const ESCAPE: &str = "escape";

/// The mentions a composer offers while one is being typed, and which is picked.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct MentionPicker {
    offered: Vec<Mention>,
    selected: usize,
}

impl MentionPicker {
    /// Offers what the word at the cursor of `input` could become, keeping the pick while
    /// the offer stays the same.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn refresh(
        &mut self,
        input: &Entity<TextareaState>,
        cx: &App,
    ) {
        let input = input.read(cx);
        let offered = mention_suggestions(&input.value(), input.cursor())
            .map(|(_, offered)| offered)
            .unwrap_or_default();
        if offered != self.offered {
            self.offered = offered;
            self.selected = 0;
        }
    }

    pub(in crate::ui::screens::shell::page::pages::sessions) fn is_open(&self) -> bool {
        !self.offered.is_empty()
    }

    fn close(&mut self) {
        self.offered.clear();
        self.selected = 0;
    }

    /// Moves the pick `by` places, round the ends.
    fn step(&mut self, by: isize) {
        let count = self.offered.len() as isize;
        if count > 0 {
            self.selected = (self.selected as isize + by).rem_euclid(count) as usize;
        }
    }

    /// Puts the mention at `index` (the picked one, when `None`) in place of the word being
    /// typed, as a chip and a space.
    fn choose(
        &mut self,
        index: Option<usize>,
        input: &Entity<TextareaState>,
        window: &mut Window,
        cx: &mut App,
    ) {
        let index = index.unwrap_or(self.selected);
        self.close();
        input.update(cx, |input, cx| {
            let Some((range, offered)) = mention_suggestions(&input.value(), input.cursor()) else {
                return;
            };
            let Some(&mention) = offered.get(index) else {
                return;
            };
            let token = chip(mention);
            let end = range.start + token.text().len();
            if let Err(error) = input.replace_range_with_token(range, token, window, cx) {
                tracing::debug!(?error, "could not insert a mention");
                return;
            }
            input.set_selected_range(end..end, cx);
            input.insert(' '.to_string(), window, cx);
            input.focus(window, cx);
        });
    }

    /// Answers `key` while mentions are offered: moves the pick, inserts it, or closes the
    /// offer. Returns whether the key was used, so the composer does not also take it.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn key(
        &mut self,
        key: &str,
        shift: bool,
        input: &Entity<TextareaState>,
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        if !self.is_open() {
            return false;
        }
        match key {
            UP => self.step(-1),
            DOWN => self.step(1),
            ENTER | TAB if !shift => self.choose(None, input, window, cx),
            ESCAPE => self.close(),
            _ => return false,
        }
        true
    }
}

/// The mentions `picker` offers, one row each with its name and what it does, the picked
/// one highlighted, and how to pick; `None` when it offers none. `id` names the rows, and
/// `place` finds the picker's composer again when one is clicked.
pub(in crate::ui::screens::shell::page::pages::sessions) fn mention_picker(
    picker: &MentionPicker,
    id: &'static str,
    place: fn(&mut AppShell) -> (&Entity<TextareaState>, &mut MentionPicker),
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<AnyElement> {
    if !picker.is_open() {
        return None;
    }
    let unit = study_ui::units(cx);
    let colors = cx.theme().colors;
    let mut list = div().w_full().flex().flex_col().gap(unit(2.));
    for (index, &mention) in picker.offered.iter().enumerate() {
        let (icon, what) = match mention {
            Mention::Assistant => (IconName::Sparkles, Message::AskAssistant),
        };
        let picked = index == picker.selected;
        list = list.child(
            div()
                .id((id, index as u64))
                .test_support()
                .role(Role::ListBoxOption)
                .aria_label(study_localization::joined(&[
                    mention_label(mention),
                    text(locale, what).to_owned(),
                ]))
                .aria_selected(picked)
                .w_full()
                .flex()
                .items_center()
                .gap(unit(10.))
                .px(unit(8.))
                .py(unit(5.))
                .rounded(unit(study_ui::scale::RADIUS_MD))
                .cursor_pointer()
                .when(picked, |row| row.bg(colors.list_active))
                .hover(|row| row.bg(colors.list_hover))
                .child(badge(icon, colors.muted_foreground, 16., cx))
                .child(
                    div()
                        .text_color(colors.foreground)
                        .child(mention_label(mention)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_ellipsis()
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .text_color(colors.muted_foreground)
                        .child(text(locale, what)),
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    let (input, picker) = place(this);
                    let input = input.clone();
                    picker.choose(Some(index), &input, window, cx);
                    cx.notify();
                })),
        );
    }
    Some(
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(6.))
            .child(list)
            .child(
                div()
                    .px(unit(8.))
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(colors.muted_foreground)
                    .child(text(locale, Message::MentionPickerHint)),
            )
            .into_any_element(),
    )
}

/// Turns every finished mention typed in `input` into a chip. A mention is finished once
/// something follows it or the cursor has left it, so `/quiz` can still grow into another
/// word while it is being typed.
pub(in crate::ui::screens::shell::page::pages::sessions) fn chip_mentions(
    input: &Entity<TextareaState>,
    window: &mut Window,
    cx: &mut App,
) {
    input.update(cx, |input, cx| {
        let text = input.value();
        let cursor = input.cursor();
        let chipped: Vec<Range<usize>> = input.tokens().iter().map(|span| span.range()).collect();
        // Where the cursor goes back to: a chip leaves it at its end, and one before it may
        // be longer or shorter than what was typed (`/schema` is stored as `/diagram`).
        let mut restored = cursor;
        let mut replaced = false;
        // From the end, so replacing one leaves the ranges before it as they were.
        for (range, mention) in study_core::mentions(&text).into_iter().rev() {
            let typing = range.end == text.len() && cursor == range.end;
            let overlaps = chipped
                .iter()
                .any(|chip| chip.start < range.end && range.start < chip.end);
            if typing || overlaps {
                continue;
            }
            let token = chip(mention);
            let grown = token.text().len() as isize - range.len() as isize;
            let before_cursor = range.end <= cursor;
            match input.replace_range_with_token(range, token, window, cx) {
                Ok(()) => {
                    replaced = true;
                    if before_cursor {
                        restored = restored.saturating_add_signed(grown);
                    }
                }
                Err(error) => tracing::debug!(?error, "a mention stays text"),
            }
        }
        if replaced {
            input.set_selected_range(restored..restored, cx);
        }
    });
}

/// Puts `mention` as a chip where the cursor is, then a space, and focuses the input.
pub(in crate::ui::screens::shell::page::pages::sessions) fn insert_mention(
    input: &Entity<TextareaState>,
    mention: Mention,
    window: &mut Window,
    cx: &mut App,
) {
    input.update(cx, |input, cx| {
        if let Err(error) = input.replace_with_token(chip(mention), window, cx) {
            tracing::debug!(?error, "could not insert a mention");
            return;
        }
        // A space after the chip, so typing goes on as a new word.
        input.insert(' '.to_string(), window, cx);
        input.focus(window, cx);
    });
}

/// The chip of `mention`: stored as notes write it, shown as the locale reads it.
fn chip(mention: Mention) -> InlineToken {
    let written = mention.written();
    InlineToken::new(written.clone(), written).with_label(mention_label(mention))
}

/// The composer's ask button: inserts the assistant's chip into `input`.
pub(in crate::ui::screens::shell::page::pages::sessions) fn ask_button(
    id: impl Into<ElementId>,
    input: &Entity<TextareaState>,
    enabled: bool,
    locale: Locale,
    cx: &App,
) -> impl IntoElement {
    let input = input.clone();
    icon_button(
        id,
        text(locale, Message::AskAssistant),
        IconName::Sparkles,
        cx,
    )
    .disabled(!enabled)
    .on_click(move |_, window, cx| insert_mention(&input, Mention::Assistant, window, cx))
}

/// A note as the transcript shows it: each mention as its label, and the ranges to
/// highlight.
pub(in crate::ui::screens::shell::page::pages::sessions) fn marked_note(
    body: &str,
) -> (String, Vec<Range<usize>>) {
    study_core::rewrite_mentions(body, &study_core::mentions(body), |mention| {
        mention_label(mention)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_note_shows_its_mentions_and_marks_them() {
        let (shown, marks) = marked_note("@study explain the cycle");
        assert_eq!(shown, "@study explain the cycle");
        let marked: Vec<&str> = marks.iter().map(|range| &shown[range.clone()]).collect();
        assert_eq!(marked, ["@study"]);
        let (shown, marks) = marked_note("no mentions here");
        assert_eq!(shown, "no mentions here");
        assert!(marks.is_empty());
    }
}
