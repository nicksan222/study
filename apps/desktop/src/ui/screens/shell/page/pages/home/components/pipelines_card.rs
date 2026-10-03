//! Activity on Home: only the work that needs the learner, each a row with what failed in a
//! short danger line, wrapped to two lines at most so the next step shows. Work that runs or
//! waits is not theirs to act on; it shows as one quiet line, or all is well.

use super::super::ids;
use super::{ellipsis, note, page_link, row_button};
use crate::features::dashboard::Snapshot;
use crate::features::jobs::{Problem, job_label};
use crate::ui::screens::shell::page::pages::components::file_tile;
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::component::ActiveTheme as _;
use study_app::views::JobStatus;
use study_core::SourceKind;
use study_localization::joined;
use study_ui::Section;
use study_ui::units;

/// Most failed jobs Home lists; Activity has the rest.
const SHOWN: usize = 4;

impl AppShell {
    /// What needs the learner; else what runs, in a word; else that all is well.
    pub(in crate::ui::screens::shell::page::pages::home) fn pipelines_card(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let colors = cx.theme().colors;
        let unit = units(cx);
        let open = page_link(
            ids::OPEN_PIPELINES,
            text(locale, Message::OpenPipelines),
            Page::Pipelines,
            cx,
        );
        let failed: Vec<_> = snapshot
            .jobs
            .iter()
            .filter(|overview| overview.job.status == JobStatus::Failed)
            .take(SHOWN)
            .collect();
        let mut rows = div().w_full().flex().flex_col();
        if failed.is_empty() {
            let working = snapshot.count(JobStatus::Running)
                + snapshot.count(JobStatus::Queued)
                + snapshot.count(JobStatus::Blocked);
            let message = if working > 0 {
                joined(&[
                    text(locale, Message::GroupWorking).to_owned(),
                    working.to_string(),
                ])
            } else {
                text(locale, Message::AllCaughtUp).to_owned()
            };
            rows = rows.child(note(message, cx));
        }
        for overview in failed {
            let job = &overview.job;
            let name = overview.subject.clone();
            let target = overview.clone();
            rows = rows.child(
                row_button((ids::JOB, job.id.get() as u64), name.clone(), cx)
                    .child(
                        div()
                            .w_full()
                            .px(unit(study_ui::scale::SPACE_XS))
                            .py(unit(6.))
                            .flex()
                            .items_start()
                            .gap(unit(study_ui::scale::SPACE_XS))
                            .child(div().pt(unit(2.)).child(file_tile(
                                overview.source_kind.unwrap_or(SourceKind::Note),
                                16.,
                                cx,
                            )))
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .items_start()
                                    .child(ellipsis(
                                        joined(&[
                                            text(locale, job_label(job.kind, overview.source_kind))
                                                .to_owned(),
                                            name,
                                        ]),
                                        study_ui::scale::TEXT_UI,
                                        None,
                                        cx,
                                    ))
                                    // The failure and its next step, wrapped rather
                                    // than cut, so the step is never lost.
                                    .child(
                                        div()
                                            .w_full()
                                            .min_w_0()
                                            .text_left()
                                            .whitespace_normal()
                                            .line_clamp(2)
                                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                                            .line_height(unit(18.))
                                            .text_color(colors.danger)
                                            .child(text(
                                                locale,
                                                Problem::of_job(job).explanation(),
                                            )),
                                    ),
                            ),
                    )
                    .on_click(
                        cx.listener(move |this, _, window, cx| this.open_job(&target, window, cx)),
                    ),
            );
        }
        Section::new(text(locale, Message::Pipelines))
            .action(open)
            .child(rows)
            .flex_1()
            .min_w(unit(360.))
            .into_any_element()
    }
}
