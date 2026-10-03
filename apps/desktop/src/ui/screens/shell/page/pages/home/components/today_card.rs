//! What to do today, at the top of Home: the flashcards due in every project as a title, the
//! nearest exam counted down in the highlighter (its project beside it in second ink), then the day's one learning action (Review
//! now, or Practice with nothing due) filled with the highlighter, beside the quick actions.

use super::super::ids;
use crate::features::dashboard::Snapshot;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonVariants as _},
};
use gpui_kit::{AnyElement, SharedString};
use study_localization::{cards_due, exam_countdown, joined};
use study_ui::{highlighter_button, units};

impl AppShell {
    /// What to do today, the nearest exam counted down, and the actions to start on it.
    pub(in crate::ui::screens::shell::page::pages::home) fn today_card(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let palette = study_ui::palette(cx);
        let due = snapshot.due_cards;
        // The nearest exam still to come, counted down.
        let today = crate::features::clock::today();
        let exam = snapshot
            .projects
            .iter()
            .filter_map(|project| {
                let days = project.exam_on?.days_since(today);
                (days >= 0).then_some((days, project.name.clone()))
            })
            .min();
        let (headline, detail, action) = if due > 0 {
            (
                cards_due(locale, due),
                text(locale, Message::TodayDue),
                highlighter_button(ids::REVIEW_DUE, text(locale, Message::ReviewNow), cx)
                    .on_click(cx.listener(|this, _, _, cx| this.review_everything_due(cx))),
            )
        } else {
            (
                text(locale, Message::TodayNothingDue).to_owned(),
                text(locale, Message::TodayPractise),
                highlighter_button(ids::PRACTISE, text(locale, Message::Practice), cx)
                    .on_click(cx.listener(|this, _, _, cx| this.navigate(Page::Practice, cx))),
            )
        };
        // The countdown is the line under the headline when there is an exam; otherwise the
        // headline's explanation is.
        let line = match exam {
            // Leads to the reviews, where each project's countdown goes on. Only the
            // countdown and its glyph are the highlighter; the project is second ink.
            Some((days, project)) => {
                let countdown = exam_countdown(locale, days);
                Button::new(ids::EXAM)
                    .accessibility_label(joined(&[countdown.clone(), project.clone()]))
                    .tab_stop(true)
                    .ghost()
                    .small()
                    .rounded(unit(study_ui::scale::RADIUS_MD))
                    // Sit flush with the headline above it.
                    .ml(unit(-8.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(unit(study_ui::scale::SPACE_XS))
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .line_height(unit(18.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(unit(6.))
                                    .text_color(palette.highlighter_ink)
                                    .child(study_ui::icon(IconName::CalendarDays).size(unit(14.)))
                                    .child(SharedString::from(countdown)),
                            )
                            .child(
                                div()
                                    .text_color(colors.muted_foreground)
                                    .child(SharedString::from(project)),
                            ),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.show_reviews(cx)))
                    .into_any_element()
            }
            None => div()
                .text_size(unit(study_ui::scale::TEXT_SMALL))
                .line_height(unit(18.))
                .text_color(colors.muted_foreground)
                .whitespace_normal()
                .child(detail)
                .into_any_element(),
        };
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_start()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .child(study_ui::heading(headline, cx))
            .child(line)
            .child(
                div()
                    .mt(unit(study_ui::scale::SPACE_SM))
                    .w_full()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_XS))
                    .child(action)
                    .children(self.quick_actions(snapshot, locale, cx)),
            )
            .into_any_element()
    }
}
