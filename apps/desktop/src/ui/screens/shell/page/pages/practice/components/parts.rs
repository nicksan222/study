//! What the Quiz views share: the column they sit in, how a verdict looks, the student's
//! answer as text, a paragraph of why, the sources a question cites, and a job that is under
//! way or failed.

use super::super::ids;
use crate::features::jobs::Problem;
use crate::ui::screens::shell::page::pages::components::{
    ChatGptState, citation_chip, job_problem_parts, status_icon,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::{AnyElement, Div, Hsla, SharedString};
use study_app::views::{
    Job, JobKind, JobStatus, PracticeAnswer, PracticeBody, PracticeQuestion, Verdict,
};
use study_core::ErrorKind;
use study_ui::units;

/// The column a quiz's parts sit in, on the canvas with no box around it; the caller
/// sets anything more.
pub(super) fn card(cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    div()
        .mt(unit(study_ui::scale::SPACE_LG))
        .w_full()
        .flex()
        .flex_col()
        .gap(unit(study_ui::scale::SPACE_MD))
}

/// What a verdict is called, its glyph and its ink: done is quiet (a faint check), partly
/// the second ink, and only a wrong answer takes the danger colour.
pub(super) fn verdict_look(
    verdict: Verdict,
    palette: &study_ui::Palette,
) -> (Message, IconName, Hsla) {
    match verdict {
        Verdict::Correct => (Message::VerdictCorrect, IconName::Check, palette.faint),
        Verdict::Partly => (Message::VerdictPartly, IconName::Minus, palette.muted),
        Verdict::Incorrect => (Message::VerdictIncorrect, IconName::X, palette.danger),
    }
}

/// A verdict as a line in its ink: its glyph and what it is called.
pub(super) fn verdict_line(verdict: Verdict, locale: Locale, cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    let (label, icon, tint) = verdict_look(verdict, &study_ui::palette(cx));
    div()
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XS))
        .text_size(unit(study_ui::scale::TEXT_UI))
        .text_color(tint)
        .font_weight(gpui_kit::FontWeight::SEMIBOLD)
        .child(study_ui::icon(icon).size(unit(16.)))
        .child(text(locale, label))
}

/// What the student answered, as text: the picked choice, or their own words.
pub(super) fn answer_text(question: &PracticeQuestion) -> Option<String> {
    let body = &question.written.as_ref()?.body;
    match (question.answer.as_ref()?, body) {
        (PracticeAnswer::Choice(index), PracticeBody::Choice { choices, .. }) => {
            choices.get(*index as usize).cloned()
        }
        (PracticeAnswer::Open(answer), _) => Some(answer.clone()),
        (PracticeAnswer::Choice(_), PracticeBody::Open { .. }) => None,
    }
}

/// A labelled block of text, such as the student's answer or the right one.
pub(super) fn labelled(label: Message, body: String, locale: Locale, cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    div()
        .flex()
        .flex_col()
        .gap(unit(4.))
        .child(
            div()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(study_ui::palette(cx).faint)
                .child(text(locale, label)),
        )
        .child(paragraph(body, cx))
}

/// Text to read through, such as why an answer was right or wrong: body type, 15 on 24.
pub(super) fn paragraph(body: String, cx: &gpui_kit::App) -> Div {
    study_ui::body_text(cx).child(SharedString::from(body))
}

/// The passages a question rests on, each opening its source; nothing when it cites none.
pub(super) fn sources(
    question: &PracticeQuestion,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<AnyElement> {
    if question.citations.is_empty() {
        return None;
    }
    let unit = units(cx);
    let mut row = div().flex().flex_wrap().items_center().gap(unit(6.)).child(
        div()
            .text_size(unit(study_ui::scale::TEXT_CAPTION))
            .text_color(study_ui::palette(cx).faint)
            .child(text(locale, Message::AnswerSources)),
    );
    for citation in &question.citations {
        let id = (
            ids::CITATION,
            (question.id.get() as u64) << 16 | u64::from(citation.marker),
        );
        row = row.child(citation_chip(
            id,
            citation,
            AppShell::peek_source,
            locale,
            cx,
        ));
    }
    Some(row.into_any_element())
}

/// The job of `question` (writing it, or grading its answer) when it waits for setup, failed or was stopped.
pub(super) fn problem_job(question: &PracticeQuestion) -> Option<&Job> {
    question
        .job
        .as_ref()
        .filter(|job| job.status.is_stopped() || job.status == JobStatus::Waiting)
}

/// Work under way, such as a question being written: a quiet spinner and what it does.
pub(super) fn working(label: Message, locale: Locale, cx: &gpui_kit::App) -> Div {
    let unit = units(cx);
    let tint = study_ui::palette(cx).faint;
    div()
        .flex()
        .items_center()
        .gap(unit(8.))
        .text_color(tint)
        .child(status_icon(
            JobStatus::Running,
            IconName::LoaderCircle,
            tint,
            unit(14.),
        ))
        .child(text(locale, label))
}

/// A job that failed or was stopped: what went wrong in plain words, a way to try again,
/// and the way to Settings when the fix is there.
pub(super) fn job_problem(
    job: &Job,
    chatgpt: ChatGptState,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    // A question that cannot be written has nothing to be written from, which the
    // general "cannot read this" would not explain.
    let nothing = job.kind == JobKind::Question && job.error_kind == Some(ErrorKind::Unsupported);
    let explanation = if nothing {
        Message::PracticeNothingToAsk
    } else {
        Problem::of_job(job).explanation()
    };
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(unit(8.))
        .children(job_problem_parts(
            (
                (ids::RETRY_JOB, job.id.get() as u64),
                (ids::SETTINGS, job.id.get() as u64),
            ),
            job,
            chatgpt,
            Some(explanation),
            AppShell::retry_practice_job,
            locale,
            cx,
        ))
        .into_any_element()
}
