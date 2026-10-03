//! One job as a row: its kind's glyph, what it works on, where it came from and when in a
//! faint line, and its state as a quiet caption on the right. Only a failure is coloured:
//! it says "Failed" in the danger colour, with what went wrong in a short line and the way
//! to try again or fix its setup.

use super::super::ids;
use super::super::page::Destination;
use crate::features::clock::now;
use crate::features::jobs::{Problem, elapsed, job_label, running_line, status_label};
use crate::ui::screens::shell::page::pages::components::{
    file_tile, job_controls, settings_button, status_icon, status_look,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, button::ButtonVariants as _};
use gpui_kit::{AnyElement, InteractiveElement as _, SharedString};
use study_app::views::{JobOverview, JobStatus};
use study_core::SourceKind;
use study_localization::{ago, breadcrumb, job_duration, joined};
use study_ui::{icon_button, units};

impl AppShell {
    /// A job's row: what it works on and its state, then, under it, its failure and what can
    /// be done.
    pub(in crate::ui::screens::shell::page::pages::pipelines) fn job_row(
        &self,
        overview: &JobOverview,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let job = &overview.job;
        let unit = units(cx);
        let colors = cx.theme().colors;
        let faint = study_ui::palette(cx).faint;
        let job_id = job.id;
        let seconds = elapsed(job, now());

        let destination = Destination::of(overview);
        let target = overview.clone();
        let open_button = icon_button(
            (ids::OPEN, job_id.get() as u64),
            text(locale, destination.label()),
            destination.icon(),
            cx,
        )
        .on_click(cx.listener(move |this, _, window, cx| this.open_job(&target, window, cx)));

        let mut row = div()
            .id((ids::ROW, job_id.get() as u64))
            .w_full()
            .px(unit(study_ui::scale::SPACE_XS))
            .py(unit(6.))
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .rounded(unit(study_ui::scale::RADIUS_MD))
            .hover(|row| row.bg(colors.secondary_hover))
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_SM))
                    .child(file_tile(
                        overview.source_kind.unwrap_or(SourceKind::Document),
                        16.,
                        cx,
                    ))
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .w_full()
                                    .text_ellipsis()
                                    .whitespace_nowrap()
                                    .text_size(unit(study_ui::scale::TEXT_UI))
                                    .child(SharedString::from(overview.subject.clone())),
                            )
                            .child(
                                div()
                                    .w_full()
                                    .text_ellipsis()
                                    .whitespace_nowrap()
                                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                    .text_color(faint)
                                    .child(SharedString::from(job_facts(
                                        overview, seconds, locale,
                                    ))),
                            ),
                    )
                    .child(status_caption(overview, locale, cx))
                    .child(open_button),
            );

        let problem = (job.status == JobStatus::Failed).then(|| Problem::of_job(job));
        // What follows the first line sits under the name, past the glyph.
        let indent = unit(16. + study_ui::scale::SPACE_SM);
        if let Some(problem) = problem {
            row = row.child(
                div()
                    .w_full()
                    .pl(indent)
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(colors.danger)
                    .whitespace_normal()
                    .child(text(locale, problem.explanation())),
            );
        }

        if job.status != JobStatus::Succeeded {
            row = row.child(self.job_actions(overview, problem, locale, cx).pl(indent));
        }
        row.into_any_element()
    }

    /// What can be done about a job: stop it, start it again, and for a failure, fix its
    /// setup. Starting again is a small quiet button; stopping and setup are ghost buttons
    /// in the second ink.
    fn job_actions(
        &self,
        overview: &JobOverview,
        problem: Option<Problem>,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let job = &overview.job;
        let job_id = job.id;
        let key = job_id.get() as u64;
        let (kind, source_kind) = (job.kind, overview.source_kind);
        let unit = units(cx);
        let muted = cx.theme().colors.muted_foreground;
        let mut actions = div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XS));
        let running = matches!(
            job.status,
            JobStatus::Blocked | JobStatus::Queued | JobStatus::Running
        );
        actions = actions.children(
            job_controls(
                ((ids::STOP, key), (ids::START, key)),
                job,
                (Self::stop_listed_job, Self::retry_listed_job),
                locale,
                cx,
            )
            .map(|control| {
                let control = control.small();
                if running {
                    control.ghost().text_color(muted)
                } else {
                    // Try again and Start again are quiet: the hover tone, ink text.
                    control
                }
            }),
        );
        if let Some(problem) = problem {
            actions = actions.children(
                settings_button(
                    (ids::SETTINGS, key),
                    problem,
                    (kind, source_kind),
                    locale,
                    cx,
                )
                .map(|button| button.small().ghost().text_color(muted)),
            );
        }
        actions
    }
}

/// The job's state on the right, as a quiet caption: a spinner and what it does while it
/// runs, a word when it waits, stopped or finished, and "Failed" in the danger colour.
fn status_caption(overview: &JobOverview, locale: Locale, cx: &gpui_kit::App) -> gpui_kit::Div {
    let job = &overview.job;
    let colors = cx.theme().colors;
    let unit = units(cx);
    let label: SharedString = match job.status {
        JobStatus::Running => running_line(locale, job, overview.source_kind, now()).into(),
        status => text(locale, status_label(status)).into(),
    };
    let (icon, _) = status_look(job.status, &colors);
    let tint = if job.status == JobStatus::Failed {
        colors.danger
    } else {
        study_ui::palette(cx).faint
    };
    let mut caption = div()
        .flex_none()
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XXS))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(tint);
    if job.status == JobStatus::Running {
        caption = caption.child(status_icon(job.status, icon, tint, unit(12.)));
    }
    caption.child(label)
}

/// Where a job came from and when, as one quiet line.
fn job_facts(overview: &JobOverview, seconds: Option<i64>, locale: Locale) -> String {
    let job = &overview.job;
    let mut facts = vec![
        text(locale, job_label(job.kind, overview.source_kind)).to_owned(),
        match (&overview.project_name, &overview.session_title) {
            (Some(project), Some(session)) => breadcrumb(project, session),
            (Some(project), None) => breadcrumb(text(locale, Message::MediaList), project),
            _ => text(locale, Message::MediaList).to_owned(),
        },
    ];
    if let Some(at) = job.finished_at.filter(|_| job.status.is_terminal()) {
        facts.push(ago(locale, now() - at));
    }
    if let Some(took) = seconds.filter(|&took| took > 0 && job.status == JobStatus::Succeeded) {
        facts.push(job_duration(took));
    }
    joined(&facts)
}
