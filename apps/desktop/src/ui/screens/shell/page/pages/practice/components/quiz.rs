//! An open quiz: its title and score, the question on screen, and the results.

use super::super::ids;
use crate::ui::screens::shell::page::pages::components::Alert;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::{AnyElement, SharedString, prelude::FluentBuilder as _};
use study_app::views::{Practice, PracticeScore};
use study_localization::{PracticeFigure, practice_figure, separator};
use study_ui::{ContentPage, button, units};

impl AppShell {
    /// An open quiz: its header, the question on screen, and the results so far.
    pub(in crate::ui::screens::shell::page::pages::practice) fn practice_view(
        &self,
        page: ContentPage,
        practice: &Practice,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        // Deleting the quiz is the title bar's; what that takes is asked in an alert.
        let page = page.action(self.delete_practice_button(locale, cx)).item(
            study_ui::page_column(study_ui::Column::Read)
                .child(self.practice_header(practice, locale, cx)),
        );
        let page = page.item(
            study_ui::page_column(study_ui::Column::Read)
                .child(self.question_view(practice, locale, cx)),
        );
        self.practice_results(page, practice, locale, cx)
    }

    /// The quiz's title, the project's name, and its score.
    fn practice_header(
        &self,
        practice: &Practice,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        study_ui::PageIntro::title(self.practice.title_of(practice))
            .meta(score(practice.score, locale, cx))
            .into_any_element()
    }

    /// Deleting the quiz, as the title bar's icon button; it asks first, in an alert.
    fn delete_practice_button(&self, locale: Locale, cx: &mut Context<Self>) -> Button {
        study_ui::icon_button(
            ids::DELETE,
            text(locale, Message::DeletePractice),
            IconName::Trash,
            cx,
        )
        .toggled(self.practice.confirm_delete)
        .on_click(cx.listener(|this, _, _, cx| {
            this.practice.confirm_delete = true;
            cx.notify();
        }))
    }

    /// While deleting the open quiz is asked: what that takes, as an alert over it.
    pub(in crate::ui::screens::shell::page) fn practice_alert(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<Alert> {
        if !self.practice.confirm_delete {
            return None;
        }
        let id = self.practice.practice.as_ref()?.id;
        // Every answer and grade goes with it.
        let confirm = button(
            ids::CONFIRM_DELETE,
            text(locale, Message::DeletePractice),
            cx,
        )
        .danger()
        .on_click(cx.listener(move |this, _, _, cx| this.delete_practice(id, cx)));
        Some(Alert::new(
            text(locale, Message::AlertDeletePractice),
            text(locale, Message::ConfirmDeletePractice),
            confirm,
            ids::CANCEL_DELETE,
            |this, cx| {
                this.practice.confirm_delete = false;
                cx.notify();
            },
        ))
    }
}

/// How the quiz is going, as one line of the header's facts: answered, correct, partly,
/// incorrect. A wrong answer is the learner's result, not a failure, so it stays in the same
/// quiet ink.
fn score(score: PracticeScore, locale: Locale, cx: &gpui_kit::App) -> AnyElement {
    let unit = units(cx);
    let figures: [(PracticeFigure, u32); 4] = [
        (PracticeFigure::Answered, score.answered),
        (PracticeFigure::Correct, score.correct),
        (PracticeFigure::Partly, score.partly),
        (PracticeFigure::Incorrect, score.incorrect),
    ];
    let mut line = div()
        .w_full()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XXS));
    for (place, (figure, value)) in figures.into_iter().enumerate() {
        line = line
            .when(place > 0, |line| line.child(separator()))
            .child(SharedString::from(practice_figure(locale, figure, value)));
    }
    line.into_any_element()
}
