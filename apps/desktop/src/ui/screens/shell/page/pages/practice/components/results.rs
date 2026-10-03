//! The questions answered so far, newest first. Each row names what the question tested and
//! how it went as a glyph (a faint check, a muted dash, a cross in the danger colour); opened,
//! it folds out an inset with the whole question, the answer given, the right one, and why.

use super::super::ids;
use super::parts::{
    answer_text, labelled, paragraph, sources, verdict_line, verdict_look, working,
};
use crate::ui::screens::shell::page::pages::components::quiet;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::{AnyElement, SharedString, prelude::FluentBuilder as _};
use study_app::views::{Practice, PracticeBody, PracticeQuestion};
use study_localization::{joined, question_number};
use study_ui::{ContentPage, units};

/// The answered questions of `practice` other than `on_screen`, newest first.
fn answered<'a>(
    practice: &'a Practice,
    on_screen: Option<&PracticeQuestion>,
) -> Vec<&'a PracticeQuestion> {
    let on_screen = on_screen.map(|question| question.id);
    let mut answered: Vec<_> = practice
        .questions
        .iter()
        .filter(|question| !question.status.is_unanswered() && Some(question.id) != on_screen)
        .collect();
    answered.sort_by_key(|question| std::cmp::Reverse((question.answered_at, question.ordinal)));
    answered
}

impl AppShell {
    /// The Results heading, then a row per answered question.
    pub(in crate::ui::screens::shell::page::pages::practice) fn practice_results(
        &self,
        mut page: ContentPage,
        practice: &Practice,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let unit = units(cx);
        page = page.item(
            study_ui::page_column(study_ui::Column::Read)
                .mt(unit(study_ui::scale::SPACE_XXL))
                .child(study_ui::heading(
                    text(locale, Message::PracticeResults),
                    cx,
                )),
        );
        let on_screen = self.practice.current_question();
        let answered = answered(practice, on_screen);
        if answered.is_empty() {
            return page.item(
                study_ui::page_column(study_ui::Column::Read)
                    .child(quiet(text(locale, Message::PracticeNoResults), cx)),
            );
        }
        let mut list = study_ui::page_column(study_ui::Column::Read)
            .mt(unit(study_ui::scale::SPACE_XS))
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XXS));
        for question in answered {
            list = list.child(self.result_row(question, locale, cx));
        }
        page.item(list)
    }

    /// One answered question: a row with its verdict and gist, opening to show how it went.
    fn result_row(
        &self,
        question: &PracticeQuestion,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let id = question.id;
        let open = self.practice.expanded.contains(&id);
        let (mark, tint) = match question.verdict {
            Some(verdict) => {
                let (_, icon, tint) = verdict_look(verdict, &palette);
                (icon, tint)
            }
            None => (IconName::LoaderCircle, palette.faint),
        };
        let gist = question
            .written
            .as_ref()
            .map(|written| written.gist.clone())
            .unwrap_or_default();
        let number = question_number(locale, question.ordinal as usize + 1);
        let row = Button::new((ids::RESULT, u64::from(question.ordinal) + 1))
            .accessibility_label(joined(&[number.clone(), gist.clone()]))
            .ghost()
            .w_full()
            .h_auto()
            .min_h(unit(32.))
            .justify_start()
            .gap(unit(study_ui::scale::SPACE_XS))
            .px(unit(study_ui::scale::SPACE_XS))
            .py(unit(6.))
            .rounded(unit(study_ui::scale::RADIUS_MD))
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_result(id, cx)))
            .child(
                study_ui::icon(mark)
                    .size(unit(16.))
                    .text_color(tint)
                    .flex_none(),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_left()
                    .text_size(unit(study_ui::scale::TEXT_UI))
                    .text_color(palette.foreground)
                    .child(SharedString::from(gist)),
            )
            .child(
                div()
                    .flex_none()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(if open { palette.muted } else { palette.faint })
                    .child(SharedString::from(number)),
            )
            .child(
                study_ui::icon(if open {
                    IconName::ChevronDown
                } else {
                    IconName::ChevronRight
                })
                .size(unit(14.))
                .text_color(palette.faint)
                .flex_none(),
            );
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .child(row)
            .when(open, |card| {
                card.child(self.result_detail(question, locale, cx))
            })
            .into_any_element()
    }

    /// An opened result, as an inset on the raised tone: the whole question, the answer
    /// given, the verdict, and why.
    fn result_detail(
        &self,
        question: &PracticeQuestion,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let mut detail = div()
            .w_full()
            .p(unit(study_ui::scale::SPACE_MD))
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_SM))
            .rounded(unit(study_ui::scale::RADIUS_MD))
            .bg(study_ui::palette(cx).fill);
        let Some(written) = &question.written else {
            return detail.into_any_element();
        };
        detail = detail.child(
            study_ui::body_text(cx)
                .font_weight(gpui_kit::FontWeight::MEDIUM)
                .child(SharedString::from(written.body.question().to_owned())),
        );
        if let Some(answer) = answer_text(question) {
            detail = detail.child(labelled(Message::YourAnswer, answer, locale, cx));
        }
        let (right, why) = match &written.body {
            PracticeBody::Choice {
                choices,
                answer,
                explanation,
                ..
            } => (
                choices.get(*answer as usize).cloned(),
                Some(explanation.clone()),
            ),
            PracticeBody::Open { reference, .. } => {
                (Some(reference.clone()), question.feedback.clone())
            }
        };
        match question.verdict {
            Some(verdict) => {
                detail = detail.child(verdict_line(verdict, locale, cx));
                if let Some(why) = why.filter(|why| !why.trim().is_empty()) {
                    detail = detail.child(paragraph(why, cx));
                }
            }
            None => detail = detail.child(working(Message::CheckingAnswer, locale, cx)),
        }
        if let Some(right) = right {
            detail = detail.child(labelled(Message::RightAnswer, right, locale, cx));
        }
        detail
            .children(sources(question, locale, cx))
            .into_any_element()
    }
}
