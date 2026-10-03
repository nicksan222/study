//! A piece of material still being written: a quiet notice with a spinner, how far the
//! job is, and a breathing outline of what is coming (lines of text, a grid of cards,
//! or boxes of a diagram), so something is visibly happening until it is done.

use crate::ui::screens::shell::page::pages::components::{kind_icon, material_status};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, spinner::Spinner};
use gpui_kit::{
    Animation, AnimationExt as _, AnyElement, Div, FontWeight, Hsla, pulsating_between,
};
use study_app::views::{Artifact, ArtifactKind};
use study_ui::{ContentPage, units};

/// How long one breath of the outline takes.
const BREATH: std::time::Duration = std::time::Duration::from_millis(1600);

/// The widths of the outline's lines of text, as shares of the column.
const LINES: [f32; 7] = [0.42, 0.96, 0.88, 0.93, 0.7, 0.9, 0.55];

impl AppShell {
    /// The material being written: what is being made and how far it is, over an outline of
    /// it that breathes until it is done.
    pub(in crate::ui::screens::shell::page::pages::study) fn writing_view(
        &self,
        page: ContentPage,
        artifact: &Artifact,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let palette = study_ui::palette(cx);
        let (status, _) = material_status(artifact, locale, &colors);
        // Running is quiet: a faint spinner and words, no coloured panel.
        let notice = div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XS))
            .py(unit(study_ui::scale::SPACE_XL))
            .child(
                Spinner::new()
                    .icon(study_ui::icon(IconName::LoaderCircle))
                    .color(palette.faint)
                    .with_size(unit(24.)),
            )
            .child(
                div()
                    .mt(unit(study_ui::scale::SPACE_XS))
                    .text_size(unit(study_ui::scale::TEXT_TITLE))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(text(locale, writing_title(artifact.kind))),
            )
            .child(
                div()
                    .max_w(unit(study_ui::scale::COLUMN_READ))
                    .text_center()
                    .whitespace_normal()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(palette.muted)
                    .child(text(locale, Message::WritingMaterialHint)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_XS))
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(palette.faint)
                    .child(study_ui::icon(kind_icon(artifact.kind)).size(unit(14.)))
                    .child(status),
            );
        page.item(notice).item(
            div()
                .w_full()
                .child(outline(artifact.kind, palette.active, cx))
                .with_animation(
                    ("material-writing", artifact.id.get() as u64),
                    Animation::new(BREATH)
                        .repeat()
                        .with_easing(pulsating_between(0.35, 0.9)),
                    |element, delta| element.opacity(delta),
                ),
        )
    }
}

/// What the card above the outline says is being made.
fn writing_title(kind: ArtifactKind) -> Message {
    match kind {
        ArtifactKind::Notes => Message::WritingNotes,
        ArtifactKind::Flashcards => Message::WritingFlashcards,
        ArtifactKind::Diagram => Message::DrawingDiagram,
    }
}

/// The shape of what is coming, in the neutral `tone`: a page of lines, a grid of cards, or
/// a few joined boxes.
fn outline(kind: ArtifactKind, tone: Hsla, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let bar = |share: f32, height: f32| {
        div()
            .h(unit(height))
            .w(gpui_kit::relative(share))
            .rounded(unit(study_ui::scale::RADIUS_FULL))
            .bg(tone)
    };
    match kind {
        ArtifactKind::Notes => div()
            .w_full()
            .flex()
            .justify_center()
            .child(
                LINES.iter().enumerate().fold(
                    panel(cx)
                        .max_w(unit(study_ui::scale::COLUMN_READ))
                        .gap(unit(study_ui::scale::SPACE_MD)),
                    |column, (index, &share)| {
                        // Notes open each topic with a heading.
                        let heading = kind == ArtifactKind::Notes && index % 3 == 0;
                        column.child(bar(
                            if heading { share * 0.5 } else { share },
                            if heading { 16. } else { 10. },
                        ))
                    },
                ),
            )
            .into_any_element(),
        ArtifactKind::Flashcards => (0..4)
            .fold(
                div().w_full().grid().grid_cols(2).gap(unit(12.)),
                |grid, _| {
                    grid.child(
                        panel(cx)
                            .h(unit(132.))
                            .gap(unit(12.))
                            .child(bar(0.85, 12.))
                            .child(bar(0.6, 12.))
                            .child(div().flex_1())
                            .child(bar(0.4, 8.)),
                    )
                },
            )
            .into_any_element(),
        ArtifactKind::Diagram => {
            let node = |share: f32| {
                div()
                    .w(gpui_kit::relative(share))
                    .h(unit(64.))
                    .rounded(unit(study_ui::scale::RADIUS_LG))
                    .bg(tone)
            };
            let link = || div().w(unit(2.)).h(unit(28.)).bg(tone);
            panel(cx)
                .h(unit(360.))
                .items_center()
                .justify_center()
                .child(node(0.3))
                .child(link())
                .child(
                    div()
                        .w_full()
                        .flex()
                        .justify_center()
                        .gap(unit(40.))
                        .child(node(0.24))
                        .child(node(0.24))
                        .child(node(0.24)),
                )
                .child(link())
                .child(node(0.36))
                .into_any_element()
        }
    }
}

/// The surface the outline is drawn on: a raised tile, no border or shadow.
fn panel(cx: &mut Context<AppShell>) -> Div {
    let unit = units(cx);
    div()
        .w_full()
        .flex()
        .flex_col()
        .px(unit(study_ui::scale::SPACE_LG))
        .py(unit(study_ui::scale::SPACE_LG))
        .rounded(unit(study_ui::scale::RADIUS_LG))
        .bg(study_ui::palette(cx).fill)
}
