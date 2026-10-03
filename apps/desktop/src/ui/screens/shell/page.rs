//! The desktop navigation shell: the map of the app.
//!
//! `AppShell` holds the one `App` and every page's state. `Page` lists the routes of the
//! sidebar's navigation, and `SettingsSection` the sections of Settings. The sidebar holds
//! the destinations as labelled rows, the page's own list (its section sidebar) between them,
//! and Settings and Help at the foot; the toolbar's toggle hides or shows it whole. Beside this file:
//!
//! - `pages/<route>/`: one folder per route. `page.rs` holds the route's state and behavior
//!   (loading, actions, its sidebar); `components/` holds the pieces it draws; `ids.rs` its
//!   element ids. Each is an `impl AppShell` block, so a page reaches the rest of the app
//!   through `self`. `pages/study/` draws the four pages of study material, one per
//!   `ArtifactKind` (`Page::material`). `pages/startup/` and `pages/onboarding/` are not on
//!   the rail: the first-launch measurement and the welcome tour, shown in place of the
//!   pages.
//! - `pages/components/`: pieces more than one page draws.
//! - `background.rs`: waiting off the UI thread (`AppShell::background` for the app's
//!   blocking calls, `AppShell::pick_files` for the file picker), and `Serial`, which keeps
//!   a load or a save from overlapping itself.
//! - `workers.rs`: starting background work, and routing what it reports to the page on
//!   screen.
//! - `search.rs`: the search palette (Ctrl+K).
//! - `testing.rs`: helpers for the page tests.
//!
//! Pages import this module with `use crate::ui::screens::shell::page::*;`, which brings in
//! the shell's types and the common GPUI and localization names.

mod background;
mod pages;
mod search;
#[cfg(test)]
mod testing;
#[cfg(test)]
mod tests;
mod workers;

use crate::app::desktop;
use crate::app::preferences::Preferences;
use crate::features::display::{ZoomCommand, ZoomLevel, zoom_shortcut};
use background::{Picked, Serial, acted};
use gpui_kit::assets::IconName;
use gpui_kit::component::{
    Disableable as _,
    button::{Button, ButtonVariants as _},
    menu::AppMenuBar,
};
use gpui_kit::{
    Context, FocusHandle, InteractiveElement as _, IntoElement, ParentElement as _, Render,
    Styled as _, Window, div,
};
use study_app::views::{ArtifactKind, JobKind};
use study_core::{Requirement, SourceKind};
use study_localization::{Locale, Message, text};
use study_ui::{MenuItem, NavigationRail, WorkspaceShell, icon_button, navigation_row};

/// The key that closes an open alert.
const ESCAPE_KEY: &str = "escape";

/// Element ids of the shell's own controls. The navigation's rows use `Page as usize`, and each
/// page keeps its own ids in an `ids` module beside its `page.rs`.
mod shell_ids {
    pub const BACK: usize = 800;
    pub const FORWARD: usize = 801;
    pub const TOGGLE_SIDEBAR: usize = 802;
    pub const SEARCH: usize = 813;
    /// The name of the key that replays the page's entrance (`AppShell::page_key`). Named,
    /// so its value never meets a numbered id.
    pub const PAGE_KEY: &str = "shell-page";
}

/// The routes of the sidebar's navigation. Each has a folder under `pages/`, but for the pages of
/// study material, which share `pages/study/`.
///
/// A new page goes in `ALL` (declaration order) and `RAIL` (where the rail shows it), and in
/// every exhaustive match below; the tests check both lists.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum Page {
    #[default]
    Home,
    MediaList,
    Projects,
    Settings,
    Help,
    Pipelines,
    Notes,
    /// The flashcard sets, and reviewing the cards that are due.
    Flashcards,
    Diagrams,
    Practice,
}

impl Page {
    /// Every page, in declaration order, so `ALL[page as usize] == page`.
    const ALL: [Self; 10] = [
        Self::Home,
        Self::MediaList,
        Self::Projects,
        Self::Settings,
        Self::Help,
        Self::Pipelines,
        Self::Notes,
        Self::Flashcards,
        Self::Diagrams,
        Self::Practice,
    ];

    /// Every page, in the order the navigation shows them; `is_utility` picks the group.
    const RAIL: [Self; 10] = [
        Self::Home,
        Self::Projects,
        Self::Notes,
        Self::Flashcards,
        Self::Diagrams,
        Self::Practice,
        Self::MediaList,
        Self::Pipelines,
        Self::Settings,
        Self::Help,
    ];

    /// The kind of study material the page holds, for the pages of material.
    fn material(self) -> Option<ArtifactKind> {
        match self {
            Self::Notes => Some(ArtifactKind::Notes),
            Self::Flashcards => Some(ArtifactKind::Flashcards),
            Self::Diagrams => Some(ArtifactKind::Diagram),
            Self::Home
            | Self::MediaList
            | Self::Projects
            | Self::Settings
            | Self::Help
            | Self::Pipelines
            | Self::Practice => None,
        }
    }

    /// The page that holds study material of `kind`.
    fn of_material(kind: ArtifactKind) -> Self {
        match kind {
            ArtifactKind::Notes => Self::Notes,
            ArtifactKind::Flashcards => Self::Flashcards,
            ArtifactKind::Diagram => Self::Diagrams,
        }
    }

    fn title(self) -> Message {
        match self {
            Self::Home => Message::Home,
            Self::MediaList => Message::MediaList,
            Self::Projects => Message::Projects,
            Self::Settings => Message::Settings,
            Self::Help => Message::Help,
            Self::Pipelines => Message::Pipelines,
            Self::Notes => Message::StudyNotes,
            Self::Flashcards => Message::Flashcards,
            Self::Diagrams => Message::Diagrams,
            Self::Practice => Message::Practice,
        }
    }

    /// Whether the page has a section sidebar of its own, under the navigation.
    fn has_sidebar(self) -> bool {
        match self {
            Self::MediaList
            | Self::Projects
            | Self::Settings
            | Self::Pipelines
            | Self::Notes
            | Self::Flashcards
            | Self::Diagrams
            | Self::Practice => true,
            Self::Home | Self::Help => false,
        }
    }

    /// Whether the page's section sidebar shows when the app starts.
    fn sidebar_open_at_start(self) -> bool {
        match self {
            Self::Projects
            | Self::Settings
            | Self::Pipelines
            | Self::Notes
            | Self::Flashcards
            | Self::Diagrams
            | Self::Practice => true,
            Self::MediaList | Self::Home | Self::Help => false,
        }
    }

    /// Whether the navigation puts the page at its foot, with Settings and Help.
    fn is_utility(self) -> bool {
        match self {
            Self::Settings | Self::Help => true,
            Self::Home
            | Self::MediaList
            | Self::Projects
            | Self::Pipelines
            | Self::Notes
            | Self::Flashcards
            | Self::Diagrams
            | Self::Practice => false,
        }
    }

    fn icon(self) -> IconName {
        match self {
            Self::Home => IconName::House,
            Self::MediaList => IconName::Images,
            Self::Projects => IconName::LibraryBig,
            Self::Settings => IconName::Settings,
            Self::Help => IconName::CircleQuestionMark,
            Self::Pipelines => IconName::Workflow,
            Self::Notes => pages::kind_icon(ArtifactKind::Notes),
            Self::Flashcards => pages::kind_icon(ArtifactKind::Flashcards),
            Self::Diagrams => pages::kind_icon(ArtifactKind::Diagram),
            Self::Practice => IconName::ListChecks,
        }
    }
}

/// The window's one view: the sidebar, the toolbar, and every page's state.
pub struct AppShell {
    active: Page,
    zoom: ZoomLevel,
    focus: FocusHandle,
    /// Takes focus back when what held it leaves the screen, such as a page's text field
    /// once the page closes, so the shell's shortcuts (Ctrl+K) keep working.
    _focus_lost: gpui_kit::Subscription,
    menu: gpui_kit::Entity<AppMenuBar>,
    /// Whether the sidebar shows at all, on every page.
    navigation_visible: bool,
    /// Whether each page's own section sidebar shows in it, by `Page as usize`.
    sidebar_visible: [bool; Page::ALL.len()],
    /// The pages Back returns to, the latest last.
    history: Vec<Page>,
    /// The pages Forward returns to, the latest last.
    forward: Vec<Page>,
    settings_section: SettingsSection,
    preferences: Preferences,
    /// The backend: the database, background work, and the event bus.
    app: study_app::App,
    /// Whether background work runs; every page that changes jobs checks it first.
    workers: workers::Workers,
    /// Saving the preferences in the background.
    saving: Serial,
    /// The preferences could not be read, or the last save failed.
    save_error: bool,
    /// The one-time measurement of this computer, shown instead of any page while it runs.
    startup: pages::Startup,
    /// The welcome tour, shown instead of the whole window while it is open.
    onboarding: pages::Onboarding,
    projects: pages::ProjectsState,
    media: pages::MediaState,
    made: pages::MadeState,
    transcription: pages::TranscriptionState,
    llm: pages::LlmState,
    system: pages::SystemState,
    processing: pages::ProcessingState,
    updates: pages::UpdatesState,
    sessions: pages::SessionsState,
    pipelines: pages::PipelinesState,
    study: pages::StudyState,
    practice: pages::PracticeState,
    dashboard: pages::DashboardState,
    search: search::SearchState,
    /// The cited passage open over the page.
    peek: pages::SourcePeek,
}

/// The sections of Settings. A new one goes in `ALL` and in every exhaustive match: here
/// (`group`, icon and copy), in `settings_page`, and for an AI section in the AI methods of
/// `pages/settings/components/overview.rs`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum SettingsSection {
    #[default]
    Language,
    Appearance,
    Updates,
    /// What runs on each kind of file, with a switch per processor.
    Processing,
    /// Every AI feature at a glance.
    Ai,
    Llm,
    Transcription,
    System,
}

/// The groups of the Settings sidebar, in the order it shows them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SettingsGroup {
    /// How the app looks and speaks, and what it does with each kind of file.
    General,
    /// The AI features, each with its readiness.
    Ai,
}

impl SettingsGroup {
    const ALL: [Self; 2] = [Self::General, Self::Ai];

    fn title(self) -> Message {
        match self {
            Self::General => Message::SettingsGeneral,
            Self::Ai => Message::SettingsAi,
        }
    }
}

impl SettingsSection {
    /// Every section, in declaration order, which is also the sidebar's order within each
    /// group: `ALL[section as usize] == section`.
    const ALL: [Self; 8] = [
        Self::Language,
        Self::Appearance,
        Self::Updates,
        Self::Processing,
        Self::Ai,
        Self::Llm,
        Self::Transcription,
        Self::System,
    ];

    fn group(self) -> SettingsGroup {
        match self {
            Self::Language | Self::Appearance | Self::Updates | Self::Processing => {
                SettingsGroup::General
            }
            Self::Ai | Self::Llm | Self::Transcription | Self::System => SettingsGroup::Ai,
        }
    }

    fn icon(self) -> IconName {
        match self {
            Self::Language => IconName::Languages,
            Self::Appearance => IconName::Palette,
            Self::Updates => IconName::Download,
            Self::Processing => IconName::Workflow,
            Self::Ai => IconName::Sparkles,
            Self::Transcription => IconName::AudioLines,
            Self::Llm => IconName::BrainCircuit,
            Self::System => IconName::Gauge,
        }
    }

    fn title(self) -> Message {
        match self {
            Self::Language => Message::Language,
            Self::Appearance => Message::Appearance,
            Self::Updates => Message::Updates,
            Self::Processing => Message::Processing,
            Self::Ai => Message::AiOverview,
            Self::Transcription => Message::Transcription,
            Self::Llm => Message::Llm,
            Self::System => Message::System,
        }
    }

    fn description(self) -> Message {
        match self {
            Self::Language => Message::LanguageDescription,
            Self::Appearance => Message::AppearanceDescription,
            Self::Updates => Message::UpdatesDescription,
            Self::Processing => Message::ProcessingDescription,
            Self::Ai => Message::AiOverviewDescription,
            Self::Transcription => Message::TranscriptionDescription,
            Self::Llm => Message::LlmDescription,
            Self::System => Message::SystemDescription,
        }
    }

    fn menu_subtitle(self) -> Message {
        match self {
            Self::Language => Message::LanguageMenuSubtitle,
            Self::Appearance => Message::AppearanceMenuSubtitle,
            Self::Updates => Message::UpdatesMenuSubtitle,
            Self::Processing => Message::ProcessingMenuSubtitle,
            Self::Ai => Message::AiOverviewMenuSubtitle,
            Self::Transcription => Message::TranscriptionMenuSubtitle,
            Self::Llm => Message::LlmMenuSubtitle,
            Self::System => Message::SystemMenuSubtitle,
        }
    }
}

impl AppShell {
    /// The shell over `app`, on Home. `save_error` says the saved preferences could not be
    /// read, so the defaults are in use.
    pub fn new(
        app: study_app::App,
        preferences: Preferences,
        save_error: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        // Focus that falls to nothing, such as from a text field that closed, goes to the
        // nearest focusable element around it, or to the shell, so shortcuts keep working.
        let focus_lost = cx.on_focus_lost(window, |shell, window, cx| {
            let target = window
                .focus_lost_restore_target(cx)
                .unwrap_or_else(|| shell.focus.clone());
            window.focus(&target, cx);
        });
        Self {
            active: Page::Home,
            zoom: ZoomLevel::from_percent(preferences.zoom_percent),
            focus,
            _focus_lost: focus_lost,
            menu: AppMenuBar::new(cx),
            navigation_visible: true,
            sidebar_visible: Page::ALL.map(Page::sidebar_open_at_start),
            history: Vec::new(),
            forward: Vec::new(),
            settings_section: SettingsSection::Language,
            preferences,
            app,
            workers: workers::Workers::default(),
            saving: Serial::default(),
            save_error,
            startup: pages::Startup::default(),
            onboarding: pages::Onboarding::default(),
            projects: pages::ProjectsState::new(window, cx),
            media: pages::MediaState::new(window, cx),
            made: pages::MadeState::new(window, cx),
            transcription: pages::TranscriptionState::new(window, cx),
            llm: pages::LlmState::new(),
            system: pages::SystemState::default(),
            processing: pages::ProcessingState::default(),
            updates: pages::UpdatesState::default(),
            sessions: pages::SessionsState::new(window, cx),
            pipelines: pages::PipelinesState::default(),
            study: pages::StudyState::default(),
            practice: pages::PracticeState::new(window, cx),
            dashboard: pages::DashboardState::default(),
            search: search::SearchState::new(window, cx),
            peek: pages::SourcePeek::default(),
        }
    }

    fn change_zoom(&mut self, command: ZoomCommand, cx: &mut Context<Self>) {
        self.zoom.apply(command);
        // An unchanged zoom still saves after a failed save, which retries it.
        if self.preferences.zoom_percent != self.zoom.percent() || self.save_error {
            self.preferences.zoom_percent = self.zoom.percent();
            self.persist(cx);
        }
        study_ui::set_zoom(cx, self.zoom.factor());
        cx.notify();
    }

    /// Opens the Settings section that sets up what a job of `kind`, on a source of `source`,
    /// needs: the language models (reading pages too), transcription, or the search model.
    fn open_settings_for(
        &mut self,
        kind: JobKind,
        source: Option<SourceKind>,
        cx: &mut Context<Self>,
    ) {
        let extractor = source.and_then(study_core::processing::first_extractor);
        self.settings_section = match study_core::processing::requirement(kind, extractor) {
            Some(Requirement::LanguageModels) => SettingsSection::Llm,
            Some(Requirement::Transcription) => SettingsSection::Transcription,
            Some(Requirement::SearchModel) => SettingsSection::System,
            None => self.settings_section,
        };
        self.navigate(Page::Settings, cx);
    }

    /// Opens `page`, remembering this one for Back, and redraws.
    fn navigate(&mut self, page: Page, cx: &mut Context<Self>) {
        if self.active != page {
            self.history.push(self.active);
            self.forward.clear();
            self.active = page;
        }
        self.enter_page(page, cx);
        cx.notify();
    }

    /// Returns to the page before this one; Forward comes back.
    fn go_back(&mut self, cx: &mut Context<Self>) {
        if let Some(page) = self.history.pop() {
            self.forward.push(self.active);
            self.show_page(page, cx);
        }
    }

    /// Returns to the page Back left.
    fn go_forward(&mut self, cx: &mut Context<Self>) {
        if let Some(page) = self.forward.pop() {
            self.history.push(self.active);
            self.show_page(page, cx);
        }
    }

    /// Shows `page` without touching the history.
    fn show_page(&mut self, page: Page, cx: &mut Context<Self>) {
        self.active = page;
        self.enter_page(page, cx);
        cx.notify();
    }

    /// Starts whatever a page needs loaded when it becomes visible.
    fn enter_page(&mut self, page: Page, cx: &mut Context<Self>) {
        match page {
            Page::Projects => {
                self.ensure_projects_loaded(cx);
                self.enter_sessions(cx);
            }
            Page::MediaList => self.load_media(cx),
            Page::Settings => self.load_settings_sections(cx),
            Page::Pipelines => {
                self.start_workers(cx);
                self.load_pipelines(cx);
            }
            Page::Notes | Page::Flashcards | Page::Diagrams => {
                self.start_workers(cx);
                if let Some(kind) = page.material() {
                    self.enter_material(kind, cx);
                }
            }
            Page::Practice => {
                self.start_workers(cx);
                self.load_practice(cx);
            }
            Page::Home => self.load_dashboard(cx),
            Page::Help => {}
        }
    }

    /// The key of the page's entrance: it changes, and replays the entrance, exactly when
    /// the page, the Settings section or the sidebar's visibility changes. Each lives in its
    /// own bits, so no count of pages or sections makes two keys meet.
    fn page_key(&self) -> gpui_kit::ElementId {
        let key = (self.active as u64) << 32
            | (self.settings_section as u64) << 1
            | u64::from(self.sidebar_visible());
        gpui_kit::ElementId::NamedInteger(shell_ids::PAGE_KEY.into(), key)
    }

    /// The key of the sidebar's entrance: the page key without the Settings section, so
    /// choosing a section in Settings' sidebar doesn't replay that sidebar's rows.
    fn sidebar_key(&self) -> gpui_kit::ElementId {
        let key = (self.active as u64) << 32 | u64::from(self.sidebar_visible());
        gpui_kit::ElementId::NamedInteger(shell_ids::PAGE_KEY.into(), key)
    }

    /// Whether the page's sidebar shows whole: the navigation, and the page's own section
    /// sidebar when it has one.
    fn sidebar_visible(&self) -> bool {
        self.navigation_visible
            && (!self.active.has_sidebar() || self.sidebar_visible[self.active as usize])
    }

    /// Hides the sidebar when it shows whole, and otherwise shows it whole: the navigation
    /// with this page's section.
    fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        if self.sidebar_visible() {
            self.navigation_visible = false;
        } else {
            self.navigation_visible = true;
            self.sidebar_visible[self.active as usize] = true;
        }
        cx.notify();
    }

    /// Saves the preferences in the background. Saves never overlap, so an older one can
    /// never finish last and win.
    fn persist(&mut self, cx: &mut Context<Self>) {
        self.save_error = false;
        if !self.saving.start() {
            return;
        }
        let preferences = self.preferences;
        self.background(
            move |app| preferences.save(app),
            |view, result, cx| {
                if view.saving.finish() {
                    view.persist(cx);
                } else {
                    view.save_error = result.is_err();
                }
                cx.notify();
            },
            cx,
        );
    }

    fn nav_row(page: Page, active: Page, locale: Locale, cx: &mut Context<Self>) -> MenuItem {
        navigation_row(
            page as usize,
            text(locale, page.title()),
            page.icon(),
            page == active,
        )
        .on_click(cx.listener(move |this, _, _, cx| {
            this.navigate(page, cx);
        }))
    }
}

impl Render for AppShell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.updates.installing() {
            return div()
                .size_full()
                .child(text(self.preferences.language, Message::UpdateInstalling));
        }
        let active = self.active;
        let locale = self.preferences.language;
        self.sync_media_search(locale, window, cx);
        match active {
            Page::Home => self.ensure_dashboard(cx),
            Page::Settings => self.sync_settings(locale, window, cx),
            Page::Projects => self.sync_projects(window, cx),
            Page::Practice => self.sync_practice(locale, window, cx),
            // The pages of material sync as they are drawn, in `workspace`.
            Page::MediaList
            | Page::Help
            | Page::Pipelines
            | Page::Notes
            | Page::Flashcards
            | Page::Diagrams => {}
        }
        // The welcome tour takes the whole window while it is open.
        let (body, alert) = match self.onboarding_view(locale, cx) {
            Some(tour) => (tour.into_any_element(), None),
            None => (
                self.workspace(locale, window, cx).into_any_element(),
                self.alert(locale, cx),
            ),
        };
        let dismiss = alert.as_ref().and_then(pages::Alert::dismiss);
        div()
            .size_full()
            .relative()
            .track_focus(&self.focus)
            .on_action(cx.listener(|_, _: &desktop::CloseWindow, window, _| window.remove_window()))
            .on_action(cx.listener(|_, _: &desktop::Quit, _, cx| cx.quit()))
            .on_action(cx.listener(|_, _: &desktop::ToggleFullscreen, window, _| {
                window.toggle_fullscreen();
            }))
            .on_action(
                cx.listener(|this, _: &desktop::ZoomIn, _, cx| {
                    this.change_zoom(ZoomCommand::In, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &desktop::ZoomOut, _, cx| {
                this.change_zoom(ZoomCommand::Out, cx)
            }))
            .on_action(cx.listener(|this, _: &desktop::ResetZoom, _, cx| {
                this.change_zoom(ZoomCommand::Reset, cx)
            }))
            .on_action(cx.listener(|this, _: &desktop::ToggleSidebar, _, cx| {
                this.toggle_sidebar(cx);
            }))
            .on_action(
                cx.listener(|this, _: &desktop::OpenSearch, window, cx| {
                    this.open_search(window, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &desktop::OpenSettings, _, cx| {
                this.navigate(Page::Settings, cx);
                this.navigation_visible = true;
                this.sidebar_visible[Page::Settings as usize] = true;
                cx.notify();
            }))
            // Captured on the way down, before a focused text field can type the `-` or `=`.
            // Escape closes an open alert, as its Cancel does, before the page sees the key.
            .capture_key_down(
                cx.listener(move |this, event: &gpui_kit::KeyDownEvent, _, cx| {
                    if let Some(command) = zoom_shortcut(&event.keystroke) {
                        this.change_zoom(command, cx);
                        cx.stop_propagation();
                    } else if event.keystroke.key == ESCAPE_KEY
                        && let Some(dismiss) = &dismiss
                    {
                        dismiss(this, cx);
                        cx.stop_propagation();
                    }
                }),
            )
            .child(body)
            .children(alert.map(|alert| alert.render(locale, cx)))
    }
}

impl AppShell {
    /// The alert the active page is asking, if any: what is about to be lost or replaced,
    /// drawn over the whole window.
    fn alert(&self, locale: Locale, cx: &mut Context<Self>) -> Option<pages::Alert> {
        match self.active {
            Page::Projects => self
                .projects_alert(locale, cx)
                .or_else(|| self.sessions_alert(locale, cx)),
            Page::MediaList => self.media_alert(locale, cx),
            Page::Notes | Page::Flashcards | Page::Diagrams => self.study_alert(locale, cx),
            Page::Practice => self.practice_alert(locale, cx),
            Page::Home | Page::Help | Page::Pipelines | Page::Settings => None,
        }
    }
}

impl AppShell {
    /// The usual window: the sidebar with the active page's own list, the page, and the
    /// toolbar.
    fn workspace(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> WorkspaceShell {
        let active = self.active;
        let sidebar = match active {
            Page::MediaList => Some(self.media_sidebar(locale, cx)),
            Page::Projects => Some(self.project_sidebar(locale, cx)),
            Page::Pipelines => Some(self.pipelines_sidebar(locale, cx)),
            Page::Notes | Page::Flashcards | Page::Diagrams => Some(self.study_sidebar(locale, cx)),
            Page::Practice => Some(self.practice_sidebar(locale, cx)),
            Page::Settings => Some(self.settings_sidebar(locale, cx)),
            Page::Home | Page::Help => None,
        };
        debug_assert_eq!(sidebar.is_some(), active.has_sidebar(), "{active:?}");
        let sidebar = sidebar.filter(|_| self.sidebar_visible[active as usize]);
        let page = match self.startup_page(locale, cx) {
            Some(startup) => startup,
            None => match active {
                Page::Home => self.home_page(locale, cx),
                Page::MediaList => self.media_page(locale, cx),
                Page::Projects => self.projects_page(locale, window, cx),
                Page::Pipelines => self.pipelines_page(locale, cx),
                Page::Notes | Page::Flashcards | Page::Diagrams => {
                    self.sync_study(locale, window, cx);
                    self.study_page(locale, cx)
                }
                Page::Practice => self.practice_page(locale, cx),
                Page::Settings => self.settings_page(cx).into(),
                Page::Help => self.help_page(locale, cx),
            },
        };
        let shell = WorkspaceShell::new(Self::rail(active, locale, cx), sidebar, page)
            .page_key(self.page_key())
            .sidebar_key(self.sidebar_key())
            .menu(self.menu.clone())
            .sidebar_visible(self.navigation_visible);
        self.with_toolbar(shell, locale, cx)
    }

    /// Every page's row, the primary ones first and the utility ones at the foot.
    fn rail(active: Page, locale: Locale, cx: &mut Context<Self>) -> NavigationRail {
        Page::RAIL
            .into_iter()
            .fold(NavigationRail::new(), |rail, page| {
                let row = Self::nav_row(page, active, locale, cx);
                if page.is_utility() {
                    rail.utility(row)
                } else {
                    rail.primary(row)
                }
            })
    }

    /// The toolbar: history and the sidebar's toggle at the start; search at the end. Zoom
    /// lives in the View menu, its shortcuts and Settings › Appearance, not here.
    fn with_toolbar(
        &self,
        shell: WorkspaceShell,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> WorkspaceShell {
        shell
            .toolbar_end_action(
                icon_button(
                    shell_ids::SEARCH,
                    text(locale, Message::Search),
                    IconName::Search,
                    cx,
                )
                .on_click(cx.listener(|this, _, window, cx| this.open_search(window, cx))),
            )
            .toolbar_action(
                icon_button(
                    shell_ids::BACK,
                    text(locale, Message::Back),
                    IconName::ArrowLeft,
                    cx,
                )
                .disabled(self.history.is_empty())
                .on_click(cx.listener(|this, _, _, cx| this.go_back(cx))),
            )
            .toolbar_action(
                icon_button(
                    shell_ids::FORWARD,
                    text(locale, Message::Forward),
                    IconName::ArrowRight,
                    cx,
                )
                .disabled(self.forward.is_empty())
                .on_click(cx.listener(|this, _, _, cx| this.go_forward(cx))),
            )
            .toolbar_action(
                icon_button(
                    shell_ids::TOGGLE_SIDEBAR,
                    text(locale, Message::ToggleSidebar),
                    IconName::PanelLeft,
                    cx,
                )
                .toggled(self.sidebar_visible())
                .on_click(cx.listener(|this, _, _, cx| this.toggle_sidebar(cx))),
            )
    }
}
