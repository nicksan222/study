//! Pipelines: everything Study is doing with attached files, in plain words. Jobs are grouped
//! by what they need from you: working now, waiting, needing attention, stopped, finished.
//! Running jobs can be stopped, and failed or stopped ones started again. The sidebar's
//! filters count each group; the page lists the jobs as rows under a heading per group, and a
//! job's row lives in `components/`.
//!
//! The database is the source of truth. Job events only say when to look again.

use super::ids;
use crate::ui::screens::shell::page::pages::components::{FirstLoad, quiet, status_line};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{SharedString, Window, prelude::FluentBuilder as _};
use study_app::views::{JobOverview, JobStatus, JobTarget};
use study_core::{ArtifactId, JobId, PracticeId, SessionId, SourceId};
use study_ui::{ContentPage, MenuItem, PageView, SectionSidebar, scaled_px, units};

/// Most jobs listed; older ones are left out.
const LIST_LIMIT: usize = 500;

/// Which jobs are shown. The groups are ordered by how much they need you.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) enum Filter {
    #[default]
    All,
    Running,
    /// Queued, or blocked until the jobs it waits for end.
    Queued,
    Failed,
    /// Cancelled.
    Stopped,
    Done,
}

impl Filter {
    const ALL: [Self; 6] = [
        Self::All,
        Self::Running,
        Self::Queued,
        Self::Failed,
        Self::Stopped,
        Self::Done,
    ];
    /// The groups of the full list, in the order they are shown.
    const GROUPS: [Self; 5] = [
        Self::Running,
        Self::Failed,
        Self::Queued,
        Self::Stopped,
        Self::Done,
    ];

    pub(super) fn label(self) -> Message {
        match self {
            Self::All => Message::FilterAll,
            Self::Running => Message::GroupWorking,
            Self::Queued => Message::GroupUpNext,
            Self::Failed => Message::GroupAttention,
            Self::Stopped => Message::GroupStopped,
            Self::Done => Message::GroupFinished,
        }
    }

    fn matches(self, status: JobStatus) -> bool {
        match self {
            Self::All => true,
            Self::Running => status == JobStatus::Running,
            Self::Queued => matches!(status, JobStatus::Queued | JobStatus::Blocked),
            Self::Failed => status == JobStatus::Failed,
            Self::Stopped => status == JobStatus::Cancelled,
            Self::Done => status == JobStatus::Succeeded,
        }
    }

    pub(super) fn icon(self) -> IconName {
        match self {
            Self::All => IconName::Workflow,
            Self::Running | Self::Queued => IconName::LoaderCircle,
            Self::Failed => IconName::CircleAlert,
            Self::Stopped => IconName::Square,
            Self::Done => IconName::CircleCheck,
        }
    }
}

/// Where a job's work shows, which its row opens.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Destination {
    /// The chat it belongs to.
    Session(SessionId),
    /// The study material it writes, on the page of its kind.
    Material(ArtifactId),
    /// The quiz whose question it writes or grades.
    Practice(PracticeId),
    /// The file it works on in the Library, or the whole Library.
    Library(Option<SourceId>),
}

impl Destination {
    pub(super) fn of(overview: &JobOverview) -> Self {
        match (
            overview.session_id,
            overview.job.target,
            overview.project_id,
            overview.practice_id,
        ) {
            (Some(session), ..) => Self::Session(session),
            (None, JobTarget::Artifact(artifact), ..) => Self::Material(artifact),
            (None, JobTarget::Question(_), _, Some(practice)) => Self::Practice(practice),
            _ => Self::Library(overview.source_id),
        }
    }

    /// What the button that opens it says.
    pub(super) fn label(self) -> Message {
        match self {
            Self::Session(_) => Message::OpenSession,
            Self::Material(..) => Message::OpenMaterial,
            Self::Practice(_) => Message::OpenPractice,
            Self::Library(_) => Message::OpenLibrary,
        }
    }

    pub(super) fn icon(self) -> IconName {
        match self {
            Self::Session(_) => IconName::NotebookText,
            Self::Material(_) => IconName::BookOpen,
            Self::Practice(_) => Page::Practice.icon(),
            Self::Library(_) => Page::MediaList.icon(),
        }
    }
}

/// The Pipelines page: the jobs listed, and how they are filtered.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct PipelinesState {
    jobs: Vec<JobOverview>,
    loaded: bool,
    loading: Serial,
    pub(super) filter: Filter,
    pub(in crate::ui::screens::shell::page) error: Option<Message>,
}

impl AppShell {
    /// Reads the jobs from the database; asks for another read if one is already running.
    pub(in crate::ui::screens::shell::page) fn load_pipelines(&mut self, cx: &mut Context<Self>) {
        if !self.pipelines.loading.start() {
            return;
        }
        self.background(
            |app| app.job_overviews(LIST_LIMIT),
            |view, result, cx| {
                let state = &mut view.pipelines;
                state.loaded = true;
                match acted(result) {
                    Some(jobs) => {
                        state.jobs = jobs;
                        // Only the load's own error is over; an action's stays readable.
                        if state.error == Some(Message::PipelinesLoadError) {
                            state.error = None;
                        }
                    }
                    None => state.error = Some(Message::PipelinesLoadError),
                }
                if state.loading.finish() {
                    view.load_pipelines(cx);
                }
                view.keep_time(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Stops a pending or running job in the list.
    pub(super) fn stop_listed_job(&mut self, job_id: JobId, cx: &mut Context<Self>) {
        self.change_listed_job(move |app| app.cancel_job(job_id), cx);
    }

    /// Starts a failed or stopped job in the list again.
    pub(super) fn retry_listed_job(&mut self, job_id: JobId, cx: &mut Context<Self>) {
        self.change_listed_job(move |app| app.retry_job(job_id), cx);
    }

    /// Runs `change` on a job in the list, then reloads the list.
    fn change_listed_job(
        &mut self,
        change: impl FnOnce(&study_app::App) -> study_core::Result<bool> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        // The last problem is over; the reload says again if loading still fails.
        self.pipelines.error = None;
        if !self.workers.allow(&mut self.pipelines.error, cx) {
            return;
        }
        // `false` means the job had already moved on; the reloaded list shows how.
        self.act(
            move |app| change(app).map(|_| true),
            |this| &mut this.pipelines.error,
            Message::JobActionError,
            |this, cx| {
                this.load_pipelines(cx);
                cx.notify();
            },
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn pipelines_sidebar(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> SectionSidebar {
        let state = &self.pipelines;
        let mut sidebar = SectionSidebar::new(text(locale, Message::Pipelines));
        for (index, filter) in Filter::ALL.into_iter().enumerate() {
            let count = self.jobs_in(filter);
            sidebar = sidebar.item(
                MenuItem::new(ids::FILTER + index, text(locale, filter.label()))
                    .icon(filter.icon())
                    .accessory(
                        div()
                            .text_size(scaled_px(cx, study_ui::scale::TEXT_CAPTION))
                            .text_color(cx.theme().colors.muted_foreground)
                            .child(SharedString::from(count.to_string())),
                    )
                    .selected(state.filter == filter)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.pipelines.filter = filter;
                        cx.notify();
                    })),
            );
        }
        sidebar
    }

    /// Opens where a job's work shows: its chat, its study material on its page, its quiz, or
    /// its file in the Library.
    pub(in crate::ui::screens::shell::page) fn open_job(
        &mut self,
        overview: &JobOverview,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match Destination::of(overview) {
            Destination::Session(session) => {
                self.navigate(Page::Projects, cx);
                self.show_project_session();
                self.open_session(session, window, cx);
            }
            Destination::Material(artifact) => self.find_material(artifact, cx),
            Destination::Practice(practice) => self.show_practice(practice, cx),
            Destination::Library(Some(source)) => self.show_media(source, window, cx),
            Destination::Library(None) => self.navigate(Page::MediaList, cx),
        }
    }

    /// Whether a listed job is running.
    pub(in crate::ui::screens::shell::page) fn pipelines_running(&self) -> bool {
        self.jobs_in(Filter::Running) > 0
    }

    /// How many listed jobs `filter` shows.
    pub(super) fn jobs_in(&self, filter: Filter) -> usize {
        self.pipelines
            .jobs
            .iter()
            .filter(|overview| filter.matches(overview.job.status))
            .count()
    }

    pub(in crate::ui::screens::shell::page) fn pipelines_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> PageView {
        let state = &self.pipelines;
        let mut page = ContentPage::new(
            text(locale, Message::Pipelines),
            text(locale, Message::PipelinesDescription),
        )
        .icon(IconName::Workflow);
        let first = FirstLoad {
            loaded: state.loaded,
            failed: state.error == Some(Message::PipelinesLoadError) && state.jobs.is_empty(),
            loading: Message::LoadingPipelines,
            load_error: Message::PipelinesLoadError,
            retry: Self::load_pipelines,
        };
        if !first.ready() {
            return first.notice(page, ids::RETRY_LOAD, locale, cx);
        }
        let unit = units(cx);
        let groups: &[Filter] = if state.filter == Filter::All {
            &Filter::GROUPS
        } else {
            std::slice::from_ref(&state.filter)
        };
        let mut shown = 0;
        for &group in groups {
            let jobs: Vec<_> = state
                .jobs
                .iter()
                .filter(|overview| group.matches(overview.job.status))
                .collect();
            if jobs.is_empty() {
                continue;
            }
            shown += jobs.len();
            if state.filter == Filter::All {
                page = page.item(
                    div()
                        .when(shown > jobs.len(), |heading| {
                            heading.mt(unit(study_ui::scale::SPACE_LG))
                        })
                        .mb(unit(study_ui::scale::SPACE_XXS))
                        .flex()
                        // Layout has no text baselines, so the two boxes share a bottom
                        // edge and the count rises by the difference in where each line
                        // box puts its baseline: title 17/24 and caption 12/16 in Inter.
                        .items_end()
                        .gap(unit(study_ui::scale::SPACE_XS))
                        .child(study_ui::heading(text(locale, group.label()), cx))
                        .child(
                            div()
                                .pb(unit(2.))
                                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                .line_height(unit(16.))
                                .text_color(study_ui::palette(cx).faint)
                                .child(SharedString::from(jobs.len().to_string())),
                        ),
                );
            }
            for overview in jobs {
                page = page.item(self.job_row(overview, locale, cx));
            }
        }
        if shown == 0 {
            page = page.item(quiet(text(locale, Message::PipelinesEmpty), cx));
        }
        status_line(page, state.error, false, locale).into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::testing::TempApp;
    use crate::ui::screens::shell::page::testing::{
        click, open_shell, set_workers, without_workers,
    };
    use crate::ui::screens::shell::page::workers::WorkersState;
    use gpui_kit::TestAppContext;

    #[gpui_kit::test]
    fn the_overview_lists_every_job_and_filters_by_status(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let database = app.database();
        assert!(database.seed_demo().unwrap());
        let overviews = database.list_job_overviews(100).unwrap();
        let failed = overviews
            .iter()
            .find(|overview| overview.job.status == JobStatus::Failed)
            .unwrap()
            .job
            .id;

        let (window, shell) = open_shell(cx, app.app(), Preferences::default());
        // Nothing runs in this test; a real pipeline would not be deterministic.
        without_workers(cx, &shell);

        click(cx, window, Page::Pipelines as usize);
        assert_eq!(
            cx.update(|cx| shell.read(cx).pipelines.jobs.len()),
            overviews.len()
        );

        // Without a running pipeline, starting a job again reports why it cannot.
        click(cx, window, ids::FILTER + 3);
        assert_eq!(
            cx.update(|cx| shell.read(cx).pipelines.filter),
            Filter::Failed
        );
        click(cx, window, (ids::START, failed.get() as u64));
        assert_eq!(
            cx.update(|cx| shell.read(cx).pipelines.error),
            Some(Message::WorkspaceUnavailable)
        );

        // The next action starts over: the old problem no longer shows.
        set_workers(cx, &shell, WorkersState::Starting);
        click(cx, window, (ids::START, failed.get() as u64));
        assert_eq!(cx.update(|cx| shell.read(cx).pipelines.error), None);
    }
}
