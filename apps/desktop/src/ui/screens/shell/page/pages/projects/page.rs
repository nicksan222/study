//! Projects: what sessions and files are filed under. The sidebar lists each
//! project with its sessions; the main area shows a project, its editor, or the open session
//! (`sessions/`). The views of the main area live in `components/`.

use super::super::sessions::{SessionView, ids as session_ids};
use super::ids;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::calendar::Date;
use gpui_kit::component::date_picker::{DatePickerEvent, DatePickerState, DateTime};
use gpui_kit::component::{
    Disableable as _, WindowExt as _,
    input::{InputEvent, InputState},
};
use gpui_kit::{AppContext as _, Entity, Subscription, Window};
use std::collections::{HashMap, HashSet};
use study_app::views::Project;
use study_core::{Day, ProjectId, SessionId};
use study_localization::age;
use study_ui::{PageView, ProjectGroup, SectionSidebar, SessionRow, icon_button};

/// What the main area of the projects page shows.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) enum ProjectsMode {
    /// A session, or the draft of a new one, is open in the main area.
    #[default]
    Session,
    /// A project's details.
    Detail(ProjectId),
    /// A project's name being changed.
    Rename(ProjectId),
    /// Asking whether to delete a project.
    ConfirmDelete(ProjectId),
}

/// The projects themselves are the session list's (`SessionsState::projects`), which the
/// sidebar draws, so one load and one list serve both.
pub(in crate::ui::screens::shell::page) struct ProjectsState {
    /// Projects folded shut in the sidebar.
    collapsed: HashSet<ProjectId>,
    /// The name on the rename page.
    pub(super) name_input: Entity<InputState>,
    /// The name in the dialog that creates a project, kept apart from `name_input` so the
    /// dialog can open over the rename page without taking its name or its Enter.
    pub(super) create_input: Entity<InputState>,
    pub(super) mode: ProjectsMode,
    pub(super) busy: bool,
    pub(super) error: Option<Message>,
    /// What went wrong in the create dialog, which the pages behind it don't show.
    pub(super) create_error: Option<Message>,
    /// The exam day of the project shown in detail.
    pub(super) exam_picker: Entity<DatePickerState>,
    /// The project `exam_picker` was last filled for.
    exam_for: Option<ProjectId>,
    /// Saves of exam days, one run at a time, so they reach the database in the order they
    /// were picked.
    exam_saving: Serial,
    /// The exam days picked and waiting for the next save run, by project.
    exam_queued: HashMap<ProjectId, Option<Day>>,
    /// The projects whose exam days the running save run is storing.
    exam_storing: HashSet<ProjectId>,
    /// Exam days picked so far, in every project.
    exam_picked: u64,
    /// The number (counted by `exam_picked`) of each project's latest pick; a read of a
    /// stored day that started before it would take it back, so it is not shown.
    exam_picks: HashMap<ProjectId, u64>,
    _input_subscription: Subscription,
    _create_subscription: Subscription,
    _exam_subscription: Subscription,
}

/// Where the exam picks stood as a read of the projects started ([`ProjectsState::exam_mark`]).
pub(in crate::ui::screens::shell::page) struct ExamMark {
    /// Picks made by then, in every project.
    picked: u64,
    /// The projects whose picks were not stored by then.
    unsaved: HashSet<ProjectId>,
}

impl ExamMark {
    /// Whether the read may lack the latest exam day picked in project `id`.
    fn misses(&self, id: ProjectId, projects: &ProjectsState) -> bool {
        self.unsaved.contains(&id) || projects.exam_pick(id) > self.picked
    }
}

/// What the sidebar marks, while the main area shows a session rather than a project.
#[derive(Clone, Copy)]
struct SidebarFocus {
    /// The open session.
    open: Option<SessionId>,
    /// The open session's project.
    open_project: Option<ProjectId>,
    /// The project a new session is being drafted in.
    drafting: Option<ProjectId>,
}

impl ProjectsState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let name_input = cx.new(|cx| InputState::new(window, cx));
        let subscription = cx.subscribe_in(
            &name_input,
            window,
            |this, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event
                    && let ProjectsMode::Rename(id) = this.projects.mode
                    && !window.has_active_dialog(cx)
                {
                    this.rename_project(id, cx);
                }
            },
        );
        let create_input = cx.new(|cx| InputState::new(window, cx));
        let create_subscription = cx.subscribe_in(
            &create_input,
            window,
            |this, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.create_project(window, cx);
                }
            },
        );
        let exam_picker = cx.new(|cx| DatePickerState::new(window, cx));
        let exam_subscription = cx.subscribe_in(
            &exam_picker,
            window,
            |this, _, event: &DatePickerEvent, _, cx| {
                let DatePickerEvent::Change(DateTime::Single(picked)) = event else {
                    return;
                };
                let picked = picked.map(|picked| picked.date());
                this.save_exam(picked, cx);
            },
        );
        Self {
            collapsed: HashSet::new(),
            name_input,
            create_input,
            mode: ProjectsMode::Session,
            busy: false,
            error: None,
            create_error: None,
            exam_picker,
            exam_for: None,
            exam_saving: Serial::default(),
            exam_queued: HashMap::new(),
            exam_storing: HashSet::new(),
            exam_picked: 0,
            exam_picks: HashMap::new(),
            _input_subscription: subscription,
            _create_subscription: create_subscription,
            _exam_subscription: exam_subscription,
        }
    }

    /// The number of the latest exam day picked in project `id`, or 0 for none.
    fn exam_pick(&self, id: ProjectId) -> u64 {
        self.exam_picks.get(&id).copied().unwrap_or_default()
    }

    /// Marks where the exam picks stand as a read of the projects starts: what it reads
    /// may lack the picks not stored yet, and any made from now on.
    pub(in crate::ui::screens::shell::page) fn exam_mark(&self) -> ExamMark {
        ExamMark {
            picked: self.exam_picked,
            unsaved: self
                .exam_queued
                .keys()
                .chain(&self.exam_storing)
                .copied()
                .collect(),
        }
    }

    /// Whether a save is under way, which holds off every other change.
    pub(super) fn working(&self) -> bool {
        self.busy
    }
}

impl AppShell {
    /// Reads the projects, and the sessions listed under them, which change together.
    pub(in crate::ui::screens::shell::page) fn ensure_projects_loaded(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        self.load_session_list(cx);
    }

    /// Shows the projects a read that started at `mark` found, keeping on screen each
    /// exam day it may have missed: one picked and not stored yet when it started, or
    /// picked since. Those are newer than what it read, and stored or on their way.
    pub(in crate::ui::screens::shell::page) fn show_projects(
        &mut self,
        projects: Vec<Project>,
        mark: &ExamMark,
    ) {
        let shown = std::mem::replace(&mut self.sessions.projects, projects);
        for project in &mut self.sessions.projects {
            if !mark.misses(project.id, &self.projects) {
                continue;
            }
            if let Some(shown) = shown.iter().find(|shown| shown.id == project.id) {
                project.exam_on = shown.exam_on;
            }
        }
    }

    /// The loaded project with `id`, if it is still there.
    pub(super) fn project(&self, id: ProjectId) -> Option<&Project> {
        self.sessions
            .projects
            .iter()
            .find(|project| project.id == id)
    }

    fn project_mut(&mut self, id: ProjectId) -> Option<&mut Project> {
        self.sessions
            .projects
            .iter_mut()
            .find(|project| project.id == id)
    }

    /// Whether the projects are known, so a new one can be added beside them.
    fn projects_known(&self) -> bool {
        self.sessions.list_loaded && self.sessions.error != Some(Message::SessionsLoadError)
    }

    /// Shows the open session (or draft) in the main area, under the project it belongs to.
    pub(in crate::ui::screens::shell::page) fn show_project_session(&mut self) {
        self.projects.mode = ProjectsMode::Session;
        self.projects.error = None;
    }

    /// Shows one project's details in the main area.
    pub(in crate::ui::screens::shell::page) fn show_project(&mut self, id: ProjectId) {
        self.projects.mode = ProjectsMode::Detail(id);
        self.projects.error = None;
    }

    /// Fills the exam picker with the day of the project shown in detail, once each time
    /// another is shown. Runs before the page is drawn, where the shell can change.
    pub(in crate::ui::screens::shell::page) fn sync_projects(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let shown = match self.projects.mode {
            ProjectsMode::Detail(id) => Some(id),
            _ => None,
        };
        if shown == self.projects.exam_for {
            return;
        }
        self.projects.exam_for = shown;
        let Some(id) = shown else {
            return;
        };
        // The material the page lists is the Study pages', read as the project is shown.
        self.load_study(cx);
        let exam = self
            .project(id)
            .and_then(|project| project.exam_on)
            .and_then(|day| chrono::NaiveDate::from_ymd_opt(day.year(), day.month(), day.day()));
        self.projects.exam_picker.update(cx, |picker, cx| {
            picker.set_date(Date::Single(exam), window, cx)
        });
    }

    /// Shows the exam day picked for the project shown in detail at once, and saves it,
    /// unless it is the one it has.
    pub(super) fn save_exam(&mut self, picked: Option<chrono::NaiveDate>, cx: &mut Context<Self>) {
        let ProjectsMode::Detail(id) = self.projects.mode else {
            return;
        };
        let day = picked.and_then(|picked| {
            use chrono::Datelike as _;
            study_core::Day::new(picked.year(), picked.month(), picked.day())
        });
        let Some(project) = self.project_mut(id) else {
            return;
        };
        if project.exam_on == day {
            return;
        }
        project.exam_on = day;
        let state = &mut self.projects;
        state.exam_queued.insert(id, day);
        state.exam_picked += 1;
        state.exam_picks.insert(id, state.exam_picked);
        cx.notify();
        self.save_exams(cx);
    }

    /// Saves the exam days waiting on screen, unless a run is under way, which saves them
    /// once it ends. A day that did not save is read again from the database rather than
    /// guessed back, since a later pick may have failed too.
    fn save_exams(&mut self, cx: &mut Context<Self>) {
        if !self.projects.exam_saving.start() {
            return;
        }
        let state = &mut self.projects;
        let queued = std::mem::take(&mut state.exam_queued);
        state.exam_storing = queued.keys().copied().collect();
        // Each day with the pick it came from, so a re-read after a failure leaves alone
        // a day picked since.
        let days: Vec<_> = queued
            .into_iter()
            .map(|(id, day)| (id, day, state.exam_pick(id)))
            .collect();
        self.background(
            move |app| {
                days.into_iter()
                    .map(|(id, day, pick)| (id, pick, app.set_exam(id, day)))
                    .collect::<Vec<_>>()
            },
            move |view, results, cx| {
                view.projects.exam_storing.clear();
                let mut failed = Vec::new();
                for (id, pick, result) in results {
                    match result {
                        Ok(true) => {}
                        Ok(false) => failed.push((id, pick)),
                        Err(error) => {
                            crate::features::errors::report(&error);
                            failed.push((id, pick));
                        }
                    }
                }
                if !failed.is_empty() {
                    view.projects.error = Some(Message::ProjectsSaveError);
                    view.reload_exam_days(failed, cx);
                }
                if view.projects.exam_saving.finish() {
                    view.save_exams(cx);
                }
                // Home and Study count down to it.
                view.load_dashboard(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Reads the stored exam days of `failed` again, and shows them, unless another day
    /// was picked since the pick (counted by `exam_picks`) that failed.
    fn reload_exam_days(&mut self, failed: Vec<(ProjectId, u64)>, cx: &mut Context<Self>) {
        self.background(
            |app| app.projects(),
            move |view, result, cx| {
                let stored = match result {
                    Ok(stored) => stored,
                    Err(error) => {
                        crate::features::errors::report(&error);
                        // Shown again with the day as it stands on screen.
                        view.projects.exam_for = None;
                        cx.notify();
                        return;
                    }
                };
                for (id, pick) in failed {
                    // A newer pick is on screen and on its way to the database.
                    if view.projects.exam_pick(id) != pick {
                        continue;
                    }
                    let day = stored.iter().find(|project| project.id == id);
                    if let (Some(stored), Some(shown)) = (day, view.project_mut(id)) {
                        shown.exam_on = stored.exam_on;
                    }
                }
                // Shown again with the day it has.
                view.projects.exam_for = None;
                cx.notify();
            },
            cx,
        );
    }

    /// Puts `name` in `input` and focuses it.
    fn set_project_name(
        input: &Entity<InputState>,
        name: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        input.update(cx, |input, cx| {
            input.set_value(name, window, cx);
            input.focus(window, cx);
        });
    }

    /// Opens the dialog that names a new project, with an empty name.
    pub(in crate::ui::screens::shell::page) fn start_project_create(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.projects.working() || !self.projects_known() {
            return;
        }
        self.projects.create_error = None;
        Self::set_project_name(&self.projects.create_input, String::new(), window, cx);
        self.open_project_create_dialog(window, cx);
        cx.notify();
    }

    /// Shows the page that renames a project, with its name in the field.
    pub(super) fn start_project_rename(
        &mut self,
        id: ProjectId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.projects.working() {
            return;
        }
        let Some(name) = self.project(id).map(|project| project.name.clone()) else {
            return;
        };
        self.projects.mode = ProjectsMode::Rename(id);
        self.projects.error = None;
        Self::set_project_name(&self.projects.name_input, name, window, cx);
        cx.notify();
    }

    /// The name typed in `input`, trimmed, or `None` when it is empty or too long.
    fn validated_project_name(input: &Entity<InputState>, cx: &gpui_kit::App) -> Option<String> {
        let name = input.read(cx).value();
        let name = name.trim();
        // The database's own limit, checked here so the field can say so.
        (!name.is_empty() && name.chars().count() <= 100).then(|| name.to_owned())
    }

    pub(super) fn create_project(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.projects.working() {
            return;
        }
        let Some(name) = Self::validated_project_name(&self.projects.create_input, cx) else {
            self.projects.create_error = Some(Message::ProjectNameError);
            cx.notify();
            return;
        };
        self.projects.busy = true;
        self.projects.create_error = None;
        cx.notify();
        self.background_in_window(
            window,
            move |app| app.create_project(&name),
            |view, result, window, cx| {
                view.projects.busy = false;
                match acted(result) {
                    Some(project) => {
                        window.close_dialog(cx);
                        view.projects.mode = ProjectsMode::Detail(project.id);
                        // Shown at once; the reload puts it in its place.
                        view.sessions.projects.insert(0, project);
                        view.load_session_list(cx);
                    }
                    None => view.projects.create_error = Some(Message::ProjectsSaveError),
                }
                cx.notify();
            },
            cx,
        );
    }

    pub(super) fn rename_project(&mut self, id: ProjectId, cx: &mut Context<Self>) {
        if self.projects.working() {
            return;
        }
        let Some(name) = Self::validated_project_name(&self.projects.name_input, cx) else {
            self.projects.error = Some(Message::ProjectNameError);
            cx.notify();
            return;
        };
        let saved_name = name.clone();
        // Once saved, the session list, which the sidebar draws, is read again.
        self.change(
            |view| (&mut view.projects.busy, &mut view.projects.error),
            move |app| app.rename_project(id, &name),
            move |view| {
                if let Some(project) = view.project_mut(id) {
                    project.name = saved_name;
                }
                view.projects.mode = ProjectsMode::Detail(id);
            },
            Message::ProjectsSaveError,
            Self::load_session_list,
            cx,
        );
    }

    /// Whether project `id` can be deleted now: no other change is saving, and no recording
    /// is going into one of its sessions.
    pub(super) fn can_delete_project(&self, id: ProjectId) -> bool {
        !self.projects.working() && self.sessions.can_delete_project(id)
    }

    pub(super) fn delete_project(&mut self, id: ProjectId, cx: &mut Context<Self>) {
        if !self.can_delete_project(id) {
            return;
        }
        self.change(
            |view| (&mut view.projects.busy, &mut view.projects.error),
            move |app| app.delete_project(id),
            move |view| {
                view.sessions.projects.retain(|project| project.id != id);
                view.projects.mode = ProjectsMode::Session;
            },
            Message::ProjectsDeleteError,
            Self::load_session_list,
            cx,
        );
    }

    /// The sidebar: each project as a folder of its sessions.
    pub(in crate::ui::screens::shell::page) fn project_sidebar(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> SectionSidebar {
        let mut sidebar = SectionSidebar::new(text(locale, Message::Projects)).action(
            icon_button(
                ids::SIDEBAR_NEW,
                text(locale, Message::NewProject),
                IconName::Plus,
                cx,
            )
            .disabled(self.projects.working() || !self.projects_known())
            .on_click(cx.listener(|this, _, window, cx| this.start_project_create(window, cx))),
        );
        let sessions = &self.sessions;
        let showing_session = self.projects.mode == ProjectsMode::Session;
        let open = showing_session.then(|| sessions.session_id()).flatten();
        let focus = SidebarFocus {
            open,
            open_project: open
                .and_then(|id| sessions.session(id))
                .map(|session| session.project_id),
            drafting: match sessions.view {
                SessionView::Draft { project_id } if showing_session => project_id,
                _ => None,
            },
        };
        let now = crate::features::clock::now();
        for project in &sessions.projects {
            sidebar = sidebar.item(self.project_group(project, focus, now, locale, cx));
        }
        sidebar
    }

    /// One project in the sidebar: a folder of its sessions, led by the draft of a new one
    /// while it is being written.
    fn project_group(
        &self,
        project: &Project,
        focus: SidebarFocus,
        now: i64,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ProjectGroup {
        let sessions = &self.sessions;
        let id = project.id;
        let project_sessions: Vec<_> = sessions
            .sessions
            .iter()
            .filter(|session| session.project_id == id)
            .collect();
        let mut group = ProjectGroup::new(
            session_ids::PROJECT + id.get() as usize,
            project.name.clone(),
        )
        .count(project_sessions.len())
        .expanded(!self.projects.collapsed.contains(&id))
        .active(focus.open_project == Some(id) || focus.drafting == Some(id))
        .on_toggle(cx.listener(move |this, _, _, cx| {
            if !this.projects.collapsed.remove(&id) {
                this.projects.collapsed.insert(id);
            }
            cx.notify();
        }))
        .action(
            icon_button(
                (session_ids::PROJECT_DETAILS, id.get() as u64),
                text(locale, Message::ProjectDetails),
                IconName::BookOpen,
                cx,
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                this.show_project(id);
                cx.notify();
            })),
        )
        .action(
            icon_button(
                (session_ids::PROJECT_NEW_SESSION, id.get() as u64),
                text(locale, Message::NewSession),
                IconName::SquarePen,
                cx,
            )
            .disabled(!sessions.can_edit())
            .on_click(cx.listener(move |this, _, window, cx| {
                this.projects.collapsed.remove(&id);
                this.start_session_in(id, window, cx)
            })),
        );
        if focus.drafting == Some(id) {
            group = group.row(
                SessionRow::new(
                    (session_ids::DRAFT_SESSION, id.get() as u64),
                    text(locale, Message::NewSession),
                )
                .selected(true),
            );
        }
        for session in project_sessions {
            let session_id = session.id;
            group = group.row(
                SessionRow::new(
                    (session_ids::SESSION, session_id.get() as u64),
                    session.title.clone(),
                )
                .age(age(locale, now - session.updated_at))
                .selected(focus.open == Some(session_id))
                .disabled(!sessions.can_edit())
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.show_project_session();
                    this.open_session(session_id, window, cx);
                })),
            );
        }
        group
    }

    pub(in crate::ui::screens::shell::page) fn projects_page(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> PageView {
        let known = |id| self.project(id).is_some();
        let page = match self.projects.mode {
            // Deleting asks in an alert over the project's page.
            ProjectsMode::Detail(id) | ProjectsMode::ConfirmDelete(id) if known(id) => {
                self.project_detail_page(id, locale, cx)
            }
            ProjectsMode::Rename(id) if known(id) => self.project_rename_page(id, locale, cx),
            // A session, or a project that is gone.
            _ => return self.sessions_page(locale, window, cx),
        };
        page.into()
    }
}
