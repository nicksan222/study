//! A cited passage, opened where the student is reading: a dialog naming the file and the
//! place, with the passage washed in the highlighter among the text just around it, and the way on to the
//! whole file in the Library. Reading the material is never left for a glance at a source.

use super::citation::cited_blocks;
use super::dialog::{centered_top, show_dialog};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    Sizable as _, WindowExt as _, button::ButtonVariants as _, spinner::Spinner,
};
use gpui_kit::{
    AnyElement, FontWeight, SharedString, StatefulInteractiveElement as _, Window,
    prelude::FluentBuilder as _,
};
use study_app::views::{Anchor, Block, Document};
use study_core::SourceId;
use study_localization::anchor_label;
use study_ui::{button, units};

/// How many blocks around the cited passage show, before and after it.
const AROUND: usize = 2;

/// Element ids of the dialog.
mod ids {
    pub const OPEN_IN_LIBRARY: usize = 9300;
    pub const CLOSE: usize = 9301;
    pub const TEXT: &str = "source-peek-text";
}

/// The passage open in the dialog, and what was read from its file once loaded.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct SourcePeek {
    cited: Option<Cited>,
}

struct Cited {
    source: SourceId,
    name: String,
    at: Anchor,
    /// What was read from the file: `None` while it loads, then `Some(None)` when nothing
    /// was.
    document: Option<Option<Document>>,
}

#[cfg(test)]
impl SourcePeek {
    /// Whether what was read from the open passage's file has loaded.
    pub(in crate::ui::screens::shell::page) fn loaded(&self) -> bool {
        self.cited
            .as_ref()
            .is_some_and(|cited| cited.document.is_some())
    }

    /// The words of the blocks marked as cited.
    pub(in crate::ui::screens::shell::page) fn marked(&self) -> Vec<String> {
        let Some(Cited {
            at,
            document: Some(Some(document)),
            ..
        }) = &self.cited
        else {
            return Vec::new();
        };
        cited_blocks(&document.blocks, Some(at))
            .into_iter()
            .map(|place| document.blocks[place].text.clone())
            .collect()
    }
}

impl AppShell {
    /// Opens the passage of file `source` (called `name`) at `at` in a dialog over the page,
    /// and reads the file's text for it.
    pub(in crate::ui::screens::shell::page) fn peek_source(
        &mut self,
        source: SourceId,
        name: String,
        at: Anchor,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.peek.cited = Some(Cited {
            source,
            name,
            at,
            document: None,
        });
        self.background(
            move |app| app.source_document(source),
            move |view, result, cx| {
                let document = result.unwrap_or_else(|error| {
                    crate::features::errors::report(&error);
                    None
                });
                // A later passage opened meanwhile keeps its own.
                if let Some(cited) = view.peek.cited.as_mut().filter(|c| c.source == source) {
                    cited.document = Some(document);
                }
                cx.notify();
            },
            cx,
        );
        let locale = self.preferences.language;
        show_dialog(
            move |this, dialog, window, cx| {
                let Some(cited) = &this.peek.cited else {
                    return dialog;
                };
                let (source, at) = (cited.source, cited.at.clone());
                dialog
                    .w(units(cx)(640.))
                    .margin_top(centered_top(window, 520., cx))
                    .child(header(cited, locale, cx))
                    .child(passage(cited, locale, cx))
                    .footer(
                        div()
                            .flex()
                            .justify_end()
                            .gap(units(cx)(8.))
                            .child(
                                button(ids::CLOSE, text(locale, Message::Close), cx)
                                    .ghost()
                                    .on_click(|_, window, cx| window.close_dialog(cx)),
                            )
                            .child(
                                button(
                                    ids::OPEN_IN_LIBRARY,
                                    text(locale, Message::OpenInLibrary),
                                    cx,
                                )
                                .primary()
                                .icon(IconName::ArrowRight)
                                .on_click(cx.listener(
                                    move |this, _, window, cx| {
                                        window.close_dialog(cx);
                                        this.show_media_at(source, at.clone(), window, cx);
                                    },
                                )),
                            ),
                    )
            },
            window,
            cx,
        );
    }
}

/// The file's kind glyph and name, and the place the passage is at.
fn header(cited: &Cited, locale: Locale, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let icon = match cited.at {
        Anchor::Time { .. } => IconName::AudioLines,
        Anchor::Page { .. } => IconName::FileText,
        _ => IconName::File,
    };
    div()
        .w_full()
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_SM))
        .pb(unit(study_ui::scale::SPACE_SM))
        .child(
            study_ui::icon(icon)
                .flex_none()
                .size(unit(16.))
                .text_color(palette.muted),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .items_baseline()
                .gap(unit(study_ui::scale::SPACE_XS))
                .child(
                    div()
                        .min_w_0()
                        .text_size(unit(study_ui::scale::TEXT_TITLE))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .child(SharedString::from(cited.name.clone())),
                )
                .child(
                    div()
                        .flex_none()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(palette.faint)
                        .children(anchor_label(locale, &cited.at)),
                ),
        )
        .into_any_element()
}

/// The cited blocks, marked, with up to [`AROUND`] blocks either side; a spinner while the
/// file's text loads, or a line saying nothing was read.
fn passage(cited: &Cited, locale: Locale, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let frame = div()
        .id(ids::TEXT)
        .w_full()
        .max_h(unit(420.))
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .gap(unit(study_ui::scale::SPACE_XXS));
    let Some(document) = &cited.document else {
        return frame
            .items_center()
            .py(unit(40.))
            .child(
                Spinner::new()
                    .icon(study_ui::icon(IconName::LoaderCircle))
                    .color(palette.faint)
                    .with_size(unit(20.)),
            )
            .into_any_element();
    };
    let blocks = document
        .as_ref()
        .map_or(&[][..], |document| &document.blocks[..]);
    let marked = cited_blocks(blocks, Some(&cited.at));
    let (Some(&first), Some(&last)) = (marked.first(), marked.last()) else {
        return frame
            .py(unit(study_ui::scale::SPACE_LG))
            .text_color(palette.muted)
            .child(text(locale, Message::NothingRead))
            .into_any_element();
    };
    let shown = first.saturating_sub(AROUND)..(last + AROUND + 1).min(blocks.len());
    frame
        .children(
            blocks[shown.clone()]
                .iter()
                .zip(shown)
                .filter(|(block, _)| !block.text.trim().is_empty())
                .map(|(block, place)| line(block, marked.contains(&place), locale, cx)),
        )
        .into_any_element()
}

/// One block: where it is, and its words. The cited ones are washed in the highlighter,
/// as a marker would, with their words in ink; the rest stay in the secondary ink.
fn line(block: &Block, cited: bool, locale: Locale, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    div()
        .w_full()
        .flex()
        .gap(unit(study_ui::scale::SPACE_SM))
        .px(unit(study_ui::scale::SPACE_SM))
        .py(unit(study_ui::scale::SPACE_XS))
        .rounded(unit(study_ui::scale::RADIUS_SM))
        .when(cited, |row| row.bg(palette.highlighter_wash))
        .child(
            div()
                .flex_none()
                .w(unit(72.))
                .pt(unit(4.))
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(if cited { palette.muted } else { palette.faint })
                .children(anchor_label(locale, &block.anchor)),
        )
        .child(
            study_ui::body_text(cx)
                .flex_1()
                .min_w_0()
                .text_color(if cited {
                    palette.foreground
                } else {
                    palette.muted
                })
                .child(SharedString::from(block.text.clone())),
        )
        .into_any_element()
}
