//! Home: the whole workspace on one calm page in the page column. Under the greeting, what
//! to do today (the cards due everywhere, the nearest exam, Review now beside the things
//! you do most), the headline numbers as one quiet line, then sections, each a heading and
//! its rows with space between and no card: the sessions to get back to, the work that
//! needs you, the newest files, and what this computer runs by itself. Every part links to
//! where it lives, and each is drawn by its own file in `components/`.

use super::ids;
use crate::features::dashboard::{self, Snapshot};
use crate::features::media::same_preview;
use crate::ui::screens::shell::page::*;
use chrono::Timelike as _;
use gpui_kit::component::Disableable as _;
use std::time::Duration;
use study_app::views::JobStatus;
use study_ui::{PageHeader, PageView, Rise, icon_button, units};

/// Pause between one section's entrance and the next.
const STAGGER: Duration = Duration::from_millis(45);

/// Home: the last snapshot of the workspace it shows.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct DashboardState {
    snapshot: Option<Snapshot>,
    loading: Serial,
    /// The last load failed, so drawing Home does not try again on every frame.
    failed: bool,
}

impl AppShell {
    /// Whether the overview shows a running job.
    pub(in crate::ui::screens::shell::page) fn dashboard_running(&self) -> bool {
        self.dashboard.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot
                .jobs
                .iter()
                .any(|overview| overview.job.status == JobStatus::Running)
        })
    }

    /// Reads the dashboard the first time Home is drawn.
    pub(in crate::ui::screens::shell::page) fn ensure_dashboard(&mut self, cx: &mut Context<Self>) {
        if self.dashboard.snapshot.is_none()
            && !self.dashboard.loading.running()
            && !self.dashboard.failed
        {
            self.load_dashboard(cx);
        }
    }

    pub(in crate::ui::screens::shell::page) fn load_dashboard(&mut self, cx: &mut Context<Self>) {
        if !self.dashboard.loading.start() {
            return;
        }
        self.background(
            dashboard::load,
            |view, result, cx| {
                let state = &mut view.dashboard;
                match result {
                    Ok(mut snapshot) => {
                        keep_previews(&mut snapshot, state.snapshot.as_ref());
                        state.snapshot = Some(snapshot);
                        state.failed = false;
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        state.failed = true;
                    }
                }
                if state.loading.finish() {
                    view.load_dashboard(cx);
                }
                view.keep_time(cx);
                cx.notify();
            },
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn home_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> PageView {
        let greeting = match chrono::Local::now().hour() {
            5..12 => Message::GreetingMorning,
            12..18 => Message::GreetingAfternoon,
            _ => Message::GreetingEvening,
        };
        let snapshot = self.dashboard.snapshot.as_ref();
        let has_projects = snapshot.is_some_and(|snapshot| !snapshot.projects.is_empty());
        let target = snapshot.and_then(Snapshot::busiest_project);
        let header = PageHeader::new(text(locale, greeting))
            .icon(IconName::House)
            .action(
                icon_button(
                    ids::NEW_SESSION,
                    text(locale, Message::NewSession),
                    IconName::SquarePen,
                    cx,
                )
                .disabled(!has_projects)
                .on_click(cx.listener(move |this, _, window, cx| {
                    if let Some(project) = target {
                        this.start_session_in(project, window, cx);
                    }
                })),
            );

        let unit = units(cx);
        let Some(snapshot) = snapshot else {
            let message = if self.dashboard.failed {
                Message::DashboardLoadError
            } else {
                Message::LoadingDashboard
            };
            return PageView::with_header(
                header,
                study_ui::EmptyState::new(text(locale, message)).failed(self.dashboard.failed),
            );
        };

        let sections = [
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(unit(study_ui::scale::SPACE_MD))
                .child(self.today_card(snapshot, locale, cx))
                .child(self.stats(snapshot, locale, cx))
                .into_any_element(),
            div()
                .w_full()
                .flex()
                .flex_wrap()
                .gap_x(unit(study_ui::scale::SPACE_XL))
                .gap_y(unit(study_ui::scale::SPACE_XXL))
                .child(self.continue_card(snapshot, locale, cx))
                .child(self.pipelines_card(snapshot, locale, cx))
                .into_any_element(),
            self.files_card(snapshot, locale, cx),
            self.computer_card(snapshot, locale, cx),
        ];
        let body = study_ui::page_scroll(ids::SCROLL, cx).child(
            study_ui::page_column(study_ui::Column::Page).child(
                study_ui::page_sections(cx).children(sections.into_iter().enumerate().map(
                    |(index, section)| {
                        Rise::new(ids::SECTION + index, section).delay(STAGGER * index as u32)
                    },
                )),
            ),
        );
        PageView::with_header(header, body)
    }
}

/// Keeps the previews `old` already shows for files `new` still lists with the same
/// contents. A preview is a picture in a folder of its own that goes when the preview does,
/// and the window may still be loading it: a reload that brought a fresh copy would take the
/// file away under it. A file changed in place, such as a link its Fetch job brought in,
/// gets a new one.
fn keep_previews(new: &mut Snapshot, old: Option<&Snapshot>) {
    let Some(old) = old else {
        return;
    };
    for file in &mut new.recent_files {
        let shown = old
            .recent_files
            .iter()
            .find(|shown| same_preview(&shown.item, &file.item))
            .and_then(|shown| shown.info.clone());
        if shown.is_some() {
            file.info = shown;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::testing::TempApp;
    use crate::ui::screens::shell::page::testing::{
        click, find, open_shell, wait_until, without_workers,
    };
    use gpui_kit::TestAppContext;

    #[gpui_kit::test]
    fn home_lists_only_the_work_that_needs_the_learner(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let database = app.database();
        assert!(study_seed::demo(&database).unwrap());
        let overviews = database.list_job_overviews(100).unwrap();

        let (window, shell) = open_shell(cx, app.app(), Preferences::default());
        without_workers(cx, &shell);
        click(cx, window, Page::Home as usize);
        wait_until(cx, |cx| {
            cx.update(|cx| shell.read(cx).dashboard.snapshot.is_some())
        });

        let snapshot = cx.update(|cx| shell.read(cx).dashboard.snapshot.clone().unwrap());
        let failed = snapshot.count(JobStatus::Failed);
        assert!(failed > 0, "the demo has failed work to show");
        for overview in &overviews {
            let row = find(cx, window, (ids::JOB, overview.job.id.get() as u64));
            if overview.job.status != JobStatus::Failed {
                assert!(
                    row.is_none(),
                    "{:?} work is not listed",
                    overview.job.status
                );
            }
        }
        let shown = snapshot
            .jobs
            .iter()
            .filter(|overview| overview.job.status == JobStatus::Failed)
            .filter(|overview| find(cx, window, (ids::JOB, overview.job.id.get() as u64)).is_some())
            .count();
        assert_eq!(shown, failed.min(4));

        // The day's one learning action is there, as is a way to every quick action.
        let action = if snapshot.due_cards > 0 {
            ids::REVIEW_DUE
        } else {
            ids::PRACTISE
        };
        assert!(find(cx, window, action).is_some());
        for id in [ids::QUICK_SESSION, ids::ADD_FILES, ids::NEW_PROJECT] {
            assert!(find(cx, window, id).is_some());
        }
    }
}
