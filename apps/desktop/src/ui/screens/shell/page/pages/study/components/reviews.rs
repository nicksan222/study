//! Flashcards' reviews: the cards due in every project as one large figure beside how
//! reviewing goes, with the way to review them (the screen's one highlighter-filled button),
//! then a tile for each project with cards due or an exam coming, its share of what is due
//! drawn as a bar, to review just its cards.

use super::super::ids;
use crate::ui::screens::shell::page::pages::components::quiet;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{Disableable as _, Sizable as _, button::ButtonVariants as _};
use gpui_kit::{AnyElement, Div, FontWeight, SharedString, prelude::FluentBuilder as _};
use study_app::views::Project;
use study_localization::{cards_due_noun, days_in_a_row, exam_countdown, reviews_this_week};
use study_ui::{ContentPage, button, units};

/// How many days off an exam is when its countdown is marked in the highlighter.
const EXAM_SOON: i64 = 7;

/// The size of the figure that says how many cards are due everywhere.
const HERO_FIGURE: f32 = 56.;

/// The narrowest a project's tile gets before the tiles wrap to fewer per row.
const PROJECT_TILE: f32 = 240.;

/// A block on the quiet fill, rounded, holding a column: the reviews' hero and each tile.
fn tile(cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    div()
        .flex()
        .flex_col()
        .rounded(unit(study_ui::scale::RADIUS_LG))
        .bg(study_ui::palette(cx).fill)
}

/// A figure over what it counts, such as `5` over `days in a row`.
fn figure(
    value: impl Into<SharedString>,
    size: f32,
    what: impl Into<SharedString>,
    cx: &gpui_kit::App,
) -> Div {
    let unit = units(cx);
    div()
        .flex()
        .flex_col()
        .child(
            div()
                .text_size(unit(size))
                .line_height(unit(size * 1.15))
                .font_weight(FontWeight::SEMIBOLD)
                .child(value.into()),
        )
        .child(
            div()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(study_ui::palette(cx).faint)
                .whitespace_normal()
                .child(what.into()),
        )
}

impl AppShell {
    /// What is due everywhere and how reviews go, at the reading width, then each project's
    /// own across the page's column, all from one left edge.
    pub(in crate::ui::screens::shell::page::pages::study) fn reviews_view(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let state = &self.study;
        let due: usize = state.due.values().sum();
        let today = crate::features::clock::today();
        let unit = units(cx);
        // The page's column: the list of projects spreads over it, while what is read (the
        // cards due, how reviews go) keeps to the reading width at the same left edge.
        let column = || div().w_full();
        let read = |child: AnyElement| study_ui::page_column(study_ui::Column::Read).child(child);
        let mut page = page.item(column().child(self.due_block(due, locale, cx)));
        let projects: Vec<(&Project, usize, Option<i64>)> = state
            .projects
            .iter()
            .map(|project| {
                let due = state.due.get(&project.id).copied().unwrap_or_default();
                let exam = project
                    .exam_on
                    .map(|day| day.days_since(today))
                    .filter(|days| *days >= 0);
                (project, due, exam)
            })
            .filter(|(_, due, exam)| *due > 0 || exam.is_some())
            .collect();
        if projects.is_empty() {
            if state.of_kind().next().is_none() {
                page = page.item(read(quiet(
                    text(locale, Message::FlashcardsDescription),
                    cx,
                )));
            }
            return page;
        }
        // A section: its heading, then the projects' tiles, wrapping on narrow windows.
        let mut tiles = div()
            .w_full()
            .flex()
            .flex_wrap()
            .gap(unit(study_ui::scale::SPACE_MD));
        for (project, project_due, exam) in projects {
            tiles = tiles.child(self.project_reviews(project, project_due, due, exam, locale, cx));
        }
        page.item(
            column()
                .mt(unit(study_ui::scale::SPACE_XL))
                .flex()
                .flex_col()
                .gap(unit(study_ui::scale::SPACE_SM))
                .child(study_ui::heading(
                    text(locale, Message::ReviewsByProject),
                    cx,
                ))
                .child(tiles),
        )
    }

    /// How many cards are due in every project as one large figure, with what reviewing
    /// does and the way to start, filled with the highlighter; or, with none due, that all is
    /// done. How reviewing goes sits beside it, a figure each.
    fn due_block(&self, due: usize, locale: Locale, cx: &mut Context<Self>) -> AnyElement {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let headline = if due > 0 {
            figure(
                due.to_string(),
                HERO_FIGURE,
                cards_due_noun(locale, due),
                cx,
            )
        } else {
            div()
                .text_size(unit(study_ui::scale::TEXT_DISPLAY))
                .font_weight(FontWeight::SEMIBOLD)
                .child(text(locale, Message::NothingDue))
        };
        let hint = if due > 0 {
            Message::ReviewDueHint
        } else {
            Message::ReviewNothingHint
        };
        let review = button(ids::REVIEW, text(locale, Message::StartReview), cx)
            .icon(IconName::Play)
            .disabled(due == 0)
            .on_click(cx.listener(|this, _, _, cx| this.review_due(None, cx)));
        // The screen's one learning action, while there is something to review.
        let review = if due > 0 { review.warning() } else { review };
        let progress = self.study.progress;
        let stats = [
            (
                progress.this_week,
                reviews_this_week(locale, progress.this_week),
            ),
            (progress.streak, days_in_a_row(locale, progress.streak)),
            (progress.coming_up, text(locale, Message::ProgressComingUp)),
        ];
        tile(cx)
            .w_full()
            .p(unit(study_ui::scale::SPACE_XL))
            .flex_row()
            .flex_wrap()
            .items_end()
            .justify_between()
            .gap(unit(study_ui::scale::SPACE_XL))
            .child(
                div()
                    .flex_1()
                    .min_w(unit(260.))
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(unit(study_ui::scale::SPACE_SM))
                    .child(headline)
                    .child(
                        div()
                            .max_w(unit(study_ui::scale::COLUMN_READ))
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .text_color(palette.muted)
                            .whitespace_normal()
                            .child(text(locale, hint)),
                    )
                    .child(div().mt(unit(study_ui::scale::SPACE_XS)).child(review)),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(unit(study_ui::scale::SPACE_XL))
                    .children(stats.map(|(count, what)| {
                        figure(count.to_string(), study_ui::scale::TEXT_DISPLAY, what, cx)
                            .max_w(unit(120.))
                    })),
            )
            .into_any_element()
    }

    /// One project's tile: its name and exam (the countdown in the highlighter once it is a
    /// week off or less), its cards due as a figure, its share of everything due as a bar, and
    /// a quiet way to review just its cards.
    fn project_reviews(
        &self,
        project: &Project,
        due: usize,
        all_due: usize,
        exam: Option<i64>,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let id = project.id;
        let soon = exam.is_some_and(|days| days <= EXAM_SOON);
        let share = if all_due == 0 {
            0.
        } else {
            due as f32 / all_due as f32
        };
        let count = if due > 0 {
            figure(
                due.to_string(),
                study_ui::scale::TEXT_DISPLAY,
                cards_due_noun(locale, due),
                cx,
            )
        } else {
            div()
                .text_size(unit(study_ui::scale::TEXT_SMALL))
                .text_color(palette.faint)
                .child(text(locale, Message::NothingDue))
        };
        // Tiles in a row share its height; the figure and bar sit at the bottom of each.
        tile(cx)
            .flex_1()
            .justify_between()
            .min_w(unit(PROJECT_TILE))
            .p(unit(study_ui::scale::SPACE_LG))
            .gap(unit(study_ui::scale::SPACE_MD))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(unit(2.))
                    .child(
                        div()
                            .text_size(unit(study_ui::scale::TEXT_UI))
                            .font_weight(FontWeight::MEDIUM)
                            .whitespace_normal()
                            .child(SharedString::from(project.name.clone())),
                    )
                    .when_some(exam, |name, days| {
                        name.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(unit(study_ui::scale::SPACE_XXS))
                                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                .text_color(if soon {
                                    palette.highlighter_ink
                                } else {
                                    palette.faint
                                })
                                .child(study_ui::icon(IconName::CalendarDays).size(unit(12.)))
                                .child(SharedString::from(exam_countdown(locale, days))),
                        )
                    }),
            )
            .child(
                div()
                    .flex()
                    .items_end()
                    .justify_between()
                    .gap(unit(study_ui::scale::SPACE_SM))
                    .child(count)
                    .child(
                        button(
                            (ids::REVIEW_PROJECT, id.get() as u64),
                            text(locale, Message::StartReview),
                            cx,
                        )
                        .ghost()
                        .small()
                        .disabled(due == 0)
                        .on_click(cx.listener(move |this, _, _, cx| this.review_due(Some(id), cx))),
                    ),
            )
            .child(
                div()
                    .w_full()
                    .h(unit(4.))
                    .rounded(unit(study_ui::scale::RADIUS_FULL))
                    .bg(palette.border)
                    .child(
                        div()
                            .h_full()
                            .w(gpui_kit::relative(share))
                            .rounded(unit(study_ui::scale::RADIUS_FULL))
                            .bg(if soon {
                                palette.highlighter
                            } else {
                                palette.muted
                            }),
                    ),
            )
            .into_any_element()
    }
}
