//! How a job is drawn wherever it shows: its state as an icon, a colour and words; the
//! buttons that stop it or start it again; and what a job needing attention offers (what went wrong,
//! trying again, the way to Settings).

use super::setup_card::{ChatGptState, setup_card, setup_requirement};
use crate::features::clock::now;
use crate::features::jobs::{Problem, elapsed, retry_label, running_line, status_label};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, Icon, Sizable as _, ThemeColor, spinner::Spinner};
use gpui_kit::{AnyElement, ElementId, Hsla, Pixels, SharedString};
use study_app::views::{Job, JobKind, JobStatus};
use study_core::JobId;
use study_localization::status_with_duration;
use study_ui::button;

/// What a page does to a job, such as starting a stopped one again: each page checks for
/// background work and reloads in its own way.
pub(in crate::ui::screens::shell::page) type JobAction =
    fn(&mut AppShell, JobId, &mut Context<AppShell>);

/// A job state's icon and colour: quiet inks for waiting, running and done (`DESIGN.md`, the
/// Quiet Success Rule), and `danger` only for a failure.
pub(in crate::ui::screens::shell::page) fn status_look(
    status: JobStatus,
    colors: &ThemeColor,
) -> (IconName, Hsla) {
    match status {
        JobStatus::Blocked | JobStatus::Waiting | JobStatus::Queued => {
            (IconName::LoaderCircle, colors.muted_foreground)
        }
        JobStatus::Running => (IconName::LoaderCircle, colors.muted_foreground),
        JobStatus::Succeeded => (IconName::CircleCheck, colors.success),
        JobStatus::Failed => (IconName::CircleAlert, colors.danger),
        JobStatus::Cancelled => (IconName::CircleAlert, colors.muted_foreground),
    }
}

/// A job's status icon; it turns while the job runs, so a long job visibly keeps going.
pub(in crate::ui::screens::shell::page) fn status_icon(
    status: JobStatus,
    icon: IconName,
    tint: Hsla,
    size: Pixels,
) -> AnyElement {
    if status == JobStatus::Running {
        Spinner::new()
            .icon(study_ui::icon(icon))
            .color(tint)
            .with_size(size)
            .into_any_element()
    } else {
        Icon::new(icon)
            .size(size)
            .text_color(tint)
            .into_any_element()
    }
}

/// How a job's state is drawn: its icon, the icon's colour, and the words. A finished job
/// says how long it took, when that was long enough to say.
pub(in crate::ui::screens::shell::page) fn job_status(
    job: &Job,
    source: Option<SourceKind>,
    locale: Locale,
    colors: &ThemeColor,
) -> (IconName, Hsla, SharedString) {
    let (icon, tint) = status_look(job.status, colors);
    let now = now();
    let words = text(locale, status_label(job.status));
    let words = match job.status {
        JobStatus::Running => running_line(locale, job, source, now),
        JobStatus::Succeeded => match elapsed(job, now).filter(|&seconds| seconds > 0) {
            Some(seconds) => status_with_duration(words, seconds),
            None => words.to_owned(),
        },
        _ => words.to_owned(),
    };
    (icon, tint, words.into())
}

/// Starts a stopped job again with the page's `retry`, saying so as its status calls for
/// ([`retry_label`]). The caller sizes it.
pub(in crate::ui::screens::shell::page) fn retry_button(
    id: impl Into<ElementId>,
    job: &Job,
    retry: JobAction,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Button {
    let job_id = job.id;
    button(id, text(locale, retry_label(job.status)), cx)
        .icon(study_ui::icon(IconName::RotateCw))
        .on_click(cx.listener(move |this, _, _, cx| retry(this, job_id, cx)))
}

/// What can be done to a job that has not succeeded: a button to stop it while it waits or
/// runs (`stop`), or to start it again once it failed or was stopped (`retry`, see
/// [`retry_button`]); `None` once it succeeded. `ids` are the stop and retry buttons'.
pub(in crate::ui::screens::shell::page) fn job_controls(
    (stop_id, retry_id): (impl Into<ElementId>, impl Into<ElementId>),
    job: &Job,
    (stop, retry): (JobAction, JobAction),
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<Button> {
    let job_id = job.id;
    match job.status {
        JobStatus::Blocked | JobStatus::Waiting | JobStatus::Queued | JobStatus::Running => Some(
            button(stop_id, text(locale, Message::StopJob), cx)
                .icon(study_ui::icon(IconName::Square))
                .on_click(cx.listener(move |this, _, _, cx| stop(this, job_id, cx))),
        ),
        JobStatus::Failed | JobStatus::Cancelled => {
            Some(retry_button(retry_id, job, retry, locale, cx))
        }
        JobStatus::Succeeded => None,
    }
}

/// What a job needing attention offers: an explanation, a retry for stopped work, and
/// Settings when its problem is fixed there. Work held up by setup gets the
/// [`setup_card`] instead, which resumes on its own once set up. Only failures use the
/// danger colour. `ids` are the retry and settings buttons'.
pub(in crate::ui::screens::shell::page) fn job_problem_parts(
    (retry_id, settings_id): (impl Into<ElementId>, impl Into<ElementId>),
    job: &Job,
    chatgpt: ChatGptState,
    explanation: Option<Message>,
    retry: JobAction,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Vec<AnyElement> {
    if let Some(requirement) = setup_requirement(job) {
        return vec![setup_card(
            (retry_id, settings_id),
            job,
            requirement,
            chatgpt,
            retry,
            locale,
            cx,
        )];
    }
    let colors = cx.theme().colors;
    let tint = if job.status == JobStatus::Failed {
        colors.danger
    } else {
        colors.muted_foreground
    };
    let mut parts = Vec::new();
    if let Some(explanation) = explanation {
        parts.push(
            div()
                .text_color(tint)
                .whitespace_normal()
                .child(text(locale, explanation))
                .into_any_element(),
        );
    }
    if job.status.is_stopped() {
        parts.push(
            retry_button(retry_id, job, retry, locale, cx)
                .small()
                .into_any_element(),
        );
    }
    let settings = settings_button(
        settings_id,
        Problem::of_job(job),
        (job.kind, None),
        locale,
        cx,
    );
    parts.extend(settings.map(|button| button.small().ghost().into_any_element()));
    parts
}

/// What a version of an entry that failed or was stopped shows on its one line: what
/// happened, and the way to try again. Unlike [`job_problem_parts`] it never draws a card, so
/// an entry stays as short as its words.
pub(in crate::ui::screens::shell::page) fn stopped_line_parts(
    retry_id: impl Into<ElementId>,
    job: &Job,
    retry: JobAction,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Vec<AnyElement> {
    let colors = cx.theme().colors;
    let mut parts = Vec::new();
    // A stopped version says nothing more: the switcher already names it, so only the way to
    // try again is left. A failed one says why.
    if job.status == JobStatus::Failed {
        parts.push(
            div()
                .text_color(colors.danger)
                .whitespace_normal()
                .child(text(locale, Problem::of_job(job).explanation()))
                .into_any_element(),
        );
        parts.push(
            div()
                .child(study_localization::separator())
                .into_any_element(),
        );
    }
    parts.push(
        retry_button(retry_id, job, retry, locale, cx)
            .ghost()
            .xsmall()
            .into_any_element(),
    );
    parts
}

/// A button to the Settings section that sets up `kind` (read from `source`), when
/// `problem` is fixed there; `None` when the fix is elsewhere. The caller sizes it.
pub(in crate::ui::screens::shell::page) fn settings_button(
    id: impl Into<ElementId>,
    problem: Problem,
    (kind, source): (JobKind, Option<SourceKind>),
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<Button> {
    problem.fixed_in_settings().then(|| {
        button(id, text(locale, Message::GoToSettings), cx)
            .icon(IconName::Settings)
            .on_click(cx.listener(move |this, _, _, cx| this.open_settings_for(kind, source, cx)))
    })
}
