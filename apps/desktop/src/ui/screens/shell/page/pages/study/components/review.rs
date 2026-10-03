//! A review under way: one card at a time, then how well it was remembered.

use super::super::ids;
use super::super::page::Review;
use super::card_face::{card_face, progress_bar};
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{Sizable as _, button::ButtonVariants as _};
use gpui_kit::{
    Div, InteractiveElement as _, Role, SharedString, StatefulInteractiveElement as _,
    prelude::FluentBuilder as _,
};
use study_app::views::Rating;
use study_localization::{cards_reviewed, joined, review_progress};
use study_ui::{ContentPage, button, units};

impl AppShell {
    /// One card at a time: the question, then the answer and how well it was remembered.
    pub(in crate::ui::screens::shell::page::pages::study) fn review_view(
        &self,
        page: ContentPage,
        review: &Review,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let Some(due) = review.cards.get(review.index) else {
            return page.item(self.review_done(review, locale, cx));
        };
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let back = button(ids::BACK, text(locale, Message::Back), cx)
            .ghost()
            .small()
            .icon(IconName::ArrowLeft)
            .on_click(cx.listener(|this, _, _, cx| this.leave_review(cx)));
        let card = card_face(
            due.artifact_title.clone().into(),
            &due.card.front,
            review.revealed.then_some(due.card.back.as_str()),
            Message::ReviewKeysHint,
            locale,
            cx,
        );
        // Named by the side it shows and what that side says, so it can be read.
        let (side, words) = if review.revealed {
            (Message::CardBack, &due.card.back)
        } else {
            (Message::CardFront, &due.card.front)
        };
        let card = div()
            .id(ids::REVIEW_FACE)
            .test_support()
            .aria_label(joined(&[text(locale, side).to_owned(), words.clone()]))
            .w_full()
            .child(card);
        let mut actions = div().w_full().flex().gap(unit(10.));
        if review.revealed {
            // One button per rating, in `Rating::ALL` order (worst to best).
            for (index, &rating) in Rating::ALL.iter().enumerate() {
                // Each button says the key that rates as it: 1 to 4.
                let label = joined(&[
                    text(locale, rating_label(rating)).to_owned(),
                    (index + 1).to_string(),
                ]);
                actions = actions.child(
                    button(ids::RATE + index, label, cx)
                        .when(rating == Rating::Good, |button| button.primary())
                        .flex_1()
                        .on_click(cx.listener(move |this, _, _, cx| this.rate_card(rating, cx))),
                );
            }
        } else {
            actions = actions.child(
                button(ids::SHOW_ANSWER, text(locale, Message::ShowAnswer), cx)
                    .primary()
                    .flex_1()
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(review) = &mut this.study.review {
                            review.revealed = true;
                        }
                        cx.notify();
                    })),
            );
        }
        let body = div()
            .id(ids::REVIEW_CARD)
            // Takes the keyboard: Space shows the answer, 1 to 4 rate it.
            .test_support()
            .role(Role::Group)
            .aria_label(text(locale, Message::ReviewKeysHint))
            .w_full()
            .max_w(unit(study_ui::Column::Read.width()))
            .flex()
            .flex_col()
            .gap(unit(16.))
            .when_some(self.study.review_focus.as_ref(), |body, focus| {
                body.track_focus(focus)
            })
            .on_key_down(cx.listener(|this, event: &gpui_kit::KeyDownEvent, _, cx| {
                if study_ui::is_shortcut(event.keystroke.modifiers) {
                    return;
                }
                if this.review_key(&event.keystroke.key, cx) {
                    cx.stop_propagation();
                }
            }))
            .child(card)
            .child(actions);
        let count = review.cards.len();
        page.item(
            study_ui::page_column(study_ui::Column::Read)
                .flex()
                .items_center()
                .gap(unit(14.))
                .child(back)
                .child(div().flex_1().child(progress_bar(review.index, count, cx)))
                .child(
                    div()
                        .flex_none()
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .text_color(palette.muted)
                        .child(SharedString::from(review_progress(
                            locale,
                            review.index + 1,
                            count,
                        ))),
                ),
        )
        .item(body)
    }

    /// A review that is over: how many cards it went through, and back to the reviews.
    fn review_done(&self, review: &Review, locale: Locale, cx: &mut Context<Self>) -> Div {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        // Done is quiet: a faint check, not a coloured badge.
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_SM))
            .py(unit(study_ui::scale::SPACE_XXL))
            .child(
                study_ui::icon(IconName::CircleCheck)
                    .size(unit(24.))
                    .text_color(palette.faint),
            )
            .child(study_ui::heading(text(locale, Message::ReviewDone), cx))
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(palette.faint)
                    .child(cards_reviewed(locale, review.cards.len())),
            )
            .child(
                button(ids::BACK, text(locale, Message::BackToFlashcards), cx)
                    .primary()
                    .on_click(cx.listener(|this, _, _, cx| this.leave_review(cx))),
            )
    }

    fn leave_review(&mut self, cx: &mut Context<Self>) {
        self.study.review = None;
        cx.notify();
    }
}

/// What a rating's button says.
fn rating_label(rating: Rating) -> Message {
    match rating {
        Rating::Again => Message::RateAgain,
        Rating::Hard => Message::RateHard,
        Rating::Good => Message::RateGood,
        Rating::Easy => Message::RateEasy,
    }
}
