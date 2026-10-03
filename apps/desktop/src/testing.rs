//! Helpers shared by the crate's tests: a temporary app, and the shell opened over it in a
//! test window. The GPUI page tests have their own on top, in
//! `ui::screens::shell::page::testing`.

use crate::app::preferences::Preferences;
use crate::ui::screens::shell::AppShell;
use gpui_kit::component::ThemeMode;
use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, TestAppContext, WindowOptions};
use std::path::{Path, PathBuf};
use study_app::App;
use study_core::db::Database;

/// Opens the shell over `app` in a light-themed test window, with reduced motion: a dialog
/// would otherwise slide in on a clock of its own, and a click, which redraws between
/// pressing and releasing, could miss one still moving on a busy machine.
pub(crate) fn open_shell(
    cx: &mut TestAppContext,
    app: App,
    preferences: Preferences,
) -> (AnyWindowHandle, Entity<AppShell>) {
    cx.update(gpui_kit::init);
    cx.update(|cx| study_ui::configure_theme(cx, ThemeMode::Light));
    cx.update(|cx| cx.set_reduce_motion(true));
    cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
            cx.new(|cx| AppShell::new(app, preferences, false, window, cx))
        })
        .unwrap()
    })
}

/// An [`App`] over a fresh database in a temporary directory, deleted when this is dropped.
/// It derefs to the app; [`TempApp::database`] opens the same file underneath it, to set up
/// or check what a test cannot reach through the app.
pub(crate) struct TempApp {
    // Declared first so the app closes before its directory goes.
    app: App,
    dir: tempfile::TempDir,
}

impl TempApp {
    pub(crate) fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let app = App::open(Self::database_path_in(dir.path())).expect("the app opens");
        Self { app, dir }
    }

    /// The app, to hand to what takes one by value.
    pub(crate) fn app(&self) -> App {
        self.app.clone()
    }

    /// The temporary directory, for files a test imports.
    pub(crate) fn dir(&self) -> &Path {
        self.dir.path()
    }

    /// The database file itself, under the app.
    pub(crate) fn database(&self) -> Database {
        Database::open(Self::database_path_in(self.dir.path())).expect("the test database opens")
    }

    fn database_path_in(dir: &Path) -> PathBuf {
        dir.join("study.sqlite3")
    }
}

impl std::ops::Deref for TempApp {
    type Target = App;

    fn deref(&self) -> &App {
        &self.app
    }
}
