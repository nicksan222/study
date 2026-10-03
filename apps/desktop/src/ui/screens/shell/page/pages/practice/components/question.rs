//! The question on screen, one at a time: its choices, or a box for an answer in the
//! student's own words; then its verdict, why, and the way on to the next question. While
//! the next one is still being written, a quiet line says so.

use super::super::ids;
use super::parts::{
    answer_text, card, job_problem, labelled, paragraph, problem_job, sources, verdict_line,
    verdict_look, working,
};
use crate::ui::screens::shell::page::pages::components::named_field;
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::Textarea;
use gpui_kit::component::{
    Disableable as _,
    button::{Button, ButtonVariants as _},
};
use gpui_kit::{
    AnyElement, Div, InteractiveElement as _, SharedString, StatefulInteractiveElement as _,
    prelude::FluentBuilder as _,
};
use study_app::views::{
    Practice, PracticeAnswer, PracticeBody, PracticeQuestion, QuestionKind, QuestionStatus, Verdict,
};
use study_localization::{choice_label, choice_letter, joined, question_number};
use study_ui::{button, units};

impl AppShell {
    /// The question on screen, or how writing it goes.
    pub(in crate::ui::screens::shell::page::pages::practice) fn question_view(
        &self,
        practice: &Practice,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let question = self.practice.current_question();
        let Some((question, written)) =
            question.and_then(|question| Some((question, question.written.as_ref()?)))
        else {
            // Not written yet: needs attention, or on its way.
            return match question.and_then(problem_job) {
                Some(job) => card(cx)
                    .child(job_problem(job, self.chatgpt_state(), locale, cx))
                    .into_any_element(),
                None => working(Message::WritingQuestion, locale, cx)
                    .mt(unit(18.))
                    .into_any_element(),
            };
        };
        let palette = study_ui::palette(cx);
        let kind = match question.kind {
            QuestionKind::Choice => Message::QuestionChoice,
            QuestionKind::Open => Message::QuestionOpen,
        };
        // The question being practised is the learning moment on this page: a thin rule in
        // the highlighter's ink marks it. No label sits above it; its number and kind lead
        // the quiet line under it.
        let mut card = card(cx)
            .border_l_2()
            .border_color(palette.highlighter_ink)
            .pl(unit(study_ui::scale::SPACE_MD))
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_TITLE))
                    .line_height(unit(24.))
                    .font_weight(gpui_kit::FontWeight::SEMIBOLD)
                    .whitespace_normal()
                    .child(SharedString::from(written.body.question().to_owned())),
            );
        card = match question.kind {
            QuestionKind::Choice => self.choices(card, question, locale, cx),
            QuestionKind::Open => self.open_answer(card, question, locale, cx),
        };
        let answered = !question.status.is_unanswered();
        if answered {
            card = card.child(self.next_row(practice, question, locale, cx));
        }
        let waiting_choice =
            question.kind == QuestionKind::Choice && question.status == QuestionStatus::Ready;
        let mut caption = vec![
            question_number(locale, question.ordinal as usize + 1),
            text(locale, kind).to_owned(),
        ];
        if waiting_choice {
            caption.push(text(locale, Message::ChoiceKeysHint).to_owned());
        } else if answered {
            caption.push(text(locale, Message::NextKeysHint).to_owned());
        }
        card.child(
            div()
                .whitespace_normal()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(palette.faint)
                .child(SharedString::from(joined(&caption))),
        )
        .track_focus(&self.practice.question_focus)
        .on_key_down(
            cx.listener(|this, event: &gpui_kit::KeyDownEvent, window, cx| {
                if study_ui::is_shortcut(event.keystroke.modifiers) {
                    return;
                }
                if this.practice_key(&event.keystroke.key, window, cx) {
                    cx.stop_propagation();
                }
            }),
        )
        .into_any_element()
    }

    /// Under an answered question: a quiet line while the next one is still being written,
    /// or why it could not be, a way to make what was missed a flashcard, and the way on.
    fn next_row(
        &self,
        practice: &Practice,
        question: &PracticeQuestion,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Div {
        // The next question is written while this one is read; until it is, say so, and
        // when writing it failed, say why here already.
        let next = practice
            .questions
            .iter()
            .find(|next| next.status.is_unanswered());
        let failed = next.and_then(problem_job);
        let writing =
            next.is_some_and(|next| next.status != QuestionStatus::Ready) && failed.is_none();
        let missed = matches!(question.verdict, Some(Verdict::Incorrect | Verdict::Partly));
        let id = question.id;
        let added = self.practice.carded.contains(&id);
        let unit = units(cx);
        div()
            .w_full()
            .flex()
            .items_center()
            .justify_end()
            .gap(unit(12.))
            .when(writing, |row| {
                row.child(working(Message::WritingQuestion, locale, cx))
            })
            .when_some(failed, |row, job| {
                row.child(job_problem(job, self.chatgpt_state(), locale, cx))
            })
            // What was missed can come back as a flashcard.
            .when(missed, |row| {
                row.child(
                    button(
                        ids::ADD_CARD,
                        text(
                            locale,
                            if added {
                                Message::AddedToFlashcards
                            } else {
                                Message::AddToFlashcards
                            },
                        ),
                        cx,
                    )
                    .ghost()
                    .icon(if added {
                        IconName::Check
                    } else {
                        IconName::Shapes
                    })
                    .disabled(added)
                    .on_click(cx.listener(move |this, _, _, cx| this.add_to_flashcards(id, cx))),
                )
            })
            .child(
                button(ids::NEXT, text(locale, Message::NextQuestion), cx)
                    .primary()
                    .icon(IconName::ArrowRight)
                    .on_click(cx.listener(|this, _, _, cx| this.next_question(cx))),
            )
    }

    /// A choice question: its choices as 40px rows on the hover tone, each with its letter
    /// key; once answered, the right one selected with a quiet check, a wrong pick in the
    /// danger colour with a cross, and why.
    fn choices(
        &self,
        mut card: Div,
        question: &PracticeQuestion,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Div {
        let Some(PracticeBody::Choice {
            choices,
            answer: right,
            explanation,
            ..
        }) = question.written.as_ref().map(|written| &written.body)
        else {
            return card;
        };
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let answered = question.status != QuestionStatus::Ready;
        let picked = match question.answer {
            Some(PracticeAnswer::Choice(index)) => Some(index),
            _ => None,
        };
        let open = !answered && !self.practice.busy;
        let mut list = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XS));
        for (index, label) in (0u32..).zip(choices) {
            // Once graded: the right choice, and a wrong pick.
            let right_one = answered && index == *right;
            let wrong_pick = answered && !right_one && picked == Some(index);
            let letter = choice_letter(index);
            let question_id = question.id;
            // Once graded, accessibility hears which choice is right and whether the pick was.
            let grade = if right_one {
                text(locale, Message::ChoiceCorrect).to_owned()
            } else if wrong_pick {
                text(locale, Message::ChoiceIncorrect).to_owned()
            } else {
                String::new()
            };
            let ink = if wrong_pick {
                palette.danger
            } else {
                palette.foreground
            };
            // A row per choice. Its id is its place, the same from one question to the
            // next, and the pick reads as pressed.
            let option = Button::new((ids::CHOICE, u64::from(index)))
                .accessibility_label(joined(&[choice_label(index, label), grade]))
                .toggled(picked == Some(index))
                .ghost()
                .w_full()
                .h_auto()
                .min_h(unit(40.))
                .px(unit(study_ui::scale::SPACE_XS))
                .py(unit(study_ui::scale::SPACE_XS))
                .rounded(unit(study_ui::scale::RADIUS_MD))
                .justify_start()
                .gap(unit(study_ui::scale::SPACE_SM))
                .disabled(!open)
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.answer_choice(question_id, index, window, cx)
                }))
                .child(
                    div()
                        .flex_none()
                        .size(unit(22.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(unit(study_ui::scale::RADIUS_SM))
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .bg(palette.active)
                        .text_color(if wrong_pick {
                            palette.danger
                        } else {
                            palette.muted
                        })
                        .child(SharedString::from(letter.to_string())),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_left()
                        .text_size(unit(study_ui::scale::TEXT_UI))
                        .text_color(ink)
                        .whitespace_normal()
                        .child(SharedString::from(label.clone())),
                )
                .when(right_one || wrong_pick, |row| {
                    let (glyph, tint) = if right_one {
                        (IconName::Check, palette.muted)
                    } else {
                        (IconName::X, palette.danger)
                    };
                    row.child(
                        study_ui::icon(glyph)
                            .size(unit(16.))
                            .text_color(tint)
                            .flex_none(),
                    )
                });
            list = list.child(
                div()
                    .w_full()
                    .rounded(unit(study_ui::scale::RADIUS_MD))
                    .bg(if right_one {
                        palette.active
                    } else {
                        palette.hover
                    })
                    .when(answered && !right_one && !wrong_pick, |row| {
                        row.opacity(0.6)
                    })
                    .child(option),
            );
        }
        card = card.child(list);
        if let Some(verdict) = question.verdict {
            card = card
                .child(verdict_block(verdict, explanation, locale, cx))
                .children(sources(question, locale, cx));
        }
        card
    }

    /// An open question: the answer box until it is answered, then the answer while it is
    /// checked, and at last its verdict, why, and what a good answer says.
    fn open_answer(
        &self,
        mut card: Div,
        question: &PracticeQuestion,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Div {
        let unit = units(cx);
        if question.status == QuestionStatus::Ready {
            let empty = self.practice.answer.read(cx).value().trim().is_empty();
            return card
                .child(named_field(
                    ids::ANSWER,
                    text(locale, Message::YourAnswer),
                    Textarea::new(&self.practice.answer)
                        .h(unit(120.))
                        .disabled(self.practice.busy)
                        .aria_label(text(locale, Message::YourAnswer)),
                ))
                .child(
                    div().w_full().flex().justify_end().child(
                        button(ids::SUBMIT, text(locale, Message::SubmitAnswer), cx)
                            .primary()
                            .icon(IconName::ArrowUp)
                            .disabled(empty || self.practice.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.submit_open_answer(window, cx)
                            })),
                    ),
                );
        }
        if let Some(answer) = answer_text(question) {
            card = card.child(labelled(Message::YourAnswer, answer, locale, cx));
        }
        match question.verdict {
            Some(verdict) => {
                let feedback = question.feedback.as_deref().unwrap_or_default();
                card = card.child(verdict_block(verdict, feedback, locale, cx));
                if let Some(PracticeBody::Open { reference, .. }) =
                    question.written.as_ref().map(|written| &written.body)
                {
                    card = card.child(labelled(
                        Message::RightAnswer,
                        reference.clone(),
                        locale,
                        cx,
                    ));
                }
                card.children(sources(question, locale, cx))
            }
            None => match problem_job(question) {
                Some(job) => card.child(job_problem(job, self.chatgpt_state(), locale, cx)),
                None => card.child(working(Message::CheckingAnswer, locale, cx)),
            },
        }
    }
}

/// The verdict on the question on screen and why, named by both so it can be read.
fn verdict_block(
    verdict: Verdict,
    why: &str,
    locale: Locale,
    cx: &gpui_kit::App,
) -> impl gpui_kit::IntoElement + use<> {
    let (name, _, _) = verdict_look(verdict, &study_ui::palette(cx));
    let why = why.trim();
    div()
        .id(ids::VERDICT)
        .test_support()
        .aria_label(joined(&[text(locale, name).to_owned(), why.to_owned()]))
        .flex()
        .flex_col()
        .gap(units(cx)(study_ui::scale::SPACE_SM))
        .child(verdict_line(verdict, locale, cx))
        .when(!why.is_empty(), |block| {
            block.child(paragraph(why.to_owned(), cx))
        })
}
