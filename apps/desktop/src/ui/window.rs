//! GPUI Kit window setup; feature screens belong in `ui/screens/`.

use super::screens;
use crate::app::desktop;
use crate::app::preferences::{Appearance, Preferences};
use crate::features::display::ZoomLevel;
use gpui_kit::component::{ThemeMode, TitleBar};
use gpui_kit::{AppContext as _, WindowBounds, WindowDecorations, WindowOptions, px, size};
use std::cell::Cell;
use std::process::ExitCode;
use std::rc::Rc;
use study_localization::{Message, text};

/// The GPUI theme for a saved appearance.
pub(crate) fn theme_mode(appearance: Appearance) -> ThemeMode {
    match appearance {
        Appearance::Light => ThemeMode::Light,
        Appearance::Dark => ThemeMode::Dark,
    }
}

/// Opens the app over its default database and shows its window, until the app quits.
pub fn run() -> ExitCode {
    let app = match study_app::App::open_default() {
        Ok(app) => app,
        Err(error) => {
            tracing::error!(error = format!("{error:#}"), "cannot start Study");
            return ExitCode::FAILURE;
        }
    };
    let (preferences, storage_error) = match Preferences::load(&app) {
        Ok(preferences) => (preferences, false),
        Err(error) => {
            crate::features::errors::report(&error);
            (Preferences::default(), true)
        }
    };
    let window_failed = Rc::new(Cell::new(false));
    let failed = window_failed.clone();
    gpui_kit::application()
        .with_assets(gpui_kit::assets::AllAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            study_ui::configure_theme(cx, theme_mode(preferences.appearance));
            // The same step the shell starts on, so a saved zoom that is no step reads as 100%.
            study_ui::set_zoom(
                cx,
                ZoomLevel::from_percent(preferences.zoom_percent).factor(),
            );
            desktop::bind_shortcuts(cx);
            desktop::install(preferences.language, cx);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::centered(size(px(1200.), px(800.)), cx)),
                window_min_size: Some(size(px(720.), px(480.))),
                is_resizable: true,
                app_id: Some(desktop::APP_ID.into()),
                window_decorations: Some(WindowDecorations::Client),
                titlebar: Some(gpui_kit::TitlebarOptions {
                    title: Some(text(preferences.language, Message::AppName).into()),
                    ..TitleBar::title_bar_options()
                }),
                ..TitleBar::window_options()
            };
            let opened = gpui_kit::open_window(options, cx, |window, cx| {
                cx.new(|cx| {
                    let mut shell =
                        screens::shell::AppShell::new(app, preferences, storage_error, window, cx);
                    // Background work resumes queued and interrupted jobs as soon as the app opens.
                    shell.start_workers(cx);
                    // Measures this computer the first time Study opens.
                    shell.start_benchmark(cx);
                    // Welcomes a new user while the measurement runs.
                    shell.start_onboarding(cx);
                    shell
                })
            });
            if let Err(error) = opened {
                tracing::error!(error = format!("{error:#}"), "cannot open the window");
                failed.set(true);
                cx.quit();
            }
        });
    if window_failed.get() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
