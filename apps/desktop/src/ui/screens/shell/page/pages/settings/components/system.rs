//! The This computer section of Settings: the hardware at a glance, where each model runs,
//! and the finer measurements, from the report saved by the first-launch measurement. How
//! the report is drawn is in `report.rs`.

mod report;

use super::super::ids;
use crate::features::errors;
use crate::ui::screens::shell::page::pages::components::quiet;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::Disableable as _;
use gpui_kit::{App, Div};
use report::{SearchModel, details, hardware, placements};
use study_app::LocalModel;
use study_app::benchmark::Report;
use study_ui::{ContentPage, button};

/// The This computer section: the measurement, and the search model's download.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct SystemState {
    report: Option<Report>,
    /// The saved report has been read, whether or not one exists.
    loaded: bool,
    /// Reading the report, or measuring again.
    busy: bool,
    /// Whether the local search model is on disk, once checked.
    search_installed: Option<bool>,
    installing: bool,
    /// What the last failure was, in the page's words; the full error chain is in the log.
    error: Option<Message>,
}

impl SystemState {
    /// Whether the local search model is on disk, once checked.
    pub(in crate::ui::screens::shell::page) fn search_installed(&self) -> Option<bool> {
        self.search_installed
    }

    pub(super) fn installing(&self) -> bool {
        self.installing
    }

    /// The measurement of this computer, once read or taken.
    pub(in crate::ui::screens::shell::page) fn report(&self) -> Option<&Report> {
        self.report.as_ref()
    }

    /// Keeps a measurement just taken, so nothing reads it again.
    pub(in crate::ui::screens::shell::page) fn set_report(&mut self, report: Report) {
        self.report = Some(report);
        self.loaded = true;
    }

    /// Checks again whether the search model is on disk, after something downloaded it.
    pub(in crate::ui::screens::shell::page) fn refresh_installed(&mut self, app: &study_app::App) {
        self.search_installed = Some(app.model_installed(LocalModel::Search));
    }
}

impl AppShell {
    /// Reads the saved report the first time the section is shown.
    pub(in crate::ui::screens::shell::page) fn sync_system(&mut self, cx: &mut Context<Self>) {
        if self.system.search_installed.is_none() {
            self.system.refresh_installed(&self.app);
        }
        let state = &self.system;
        if state.loaded || state.busy || state.error.is_some() {
            return;
        }
        self.run_system(Message::SysLoadError, false, cx);
    }

    /// Downloads the search model; the indexer picks it up by itself.
    pub(super) fn install_search_model(&mut self, cx: &mut Context<Self>) {
        if self.system.installing {
            return;
        }
        self.system.installing = true;
        self.system.error = None;
        cx.notify();
        let app = self.app.clone();
        let install = self
            .app
            .spawn(async move { app.install_model(LocalModel::Search).await });
        cx.spawn(async move |this, cx| {
            let result = install.await;
            let _ = this.update(cx, |view, cx| {
                view.system.installing = false;
                view.system.refresh_installed(&view.app);
                if let Err(error) | Ok(Err(error)) = result.map_err(study_core::Error::from) {
                    errors::report(&error);
                    view.system.error = Some(Message::ModelDownloadError);
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Each model that runs here and whether it can, as the This computer section shows it.
    pub(in crate::ui::screens::shell::page) fn model_placements(
        &self,
        report: &Report,
        locale: Locale,
        cx: &App,
    ) -> Div {
        let search = SearchModel {
            installed: self.system.search_installed() == Some(true),
            size_bytes: self.app.model_size(LocalModel::Search),
        };
        placements(report, search, locale, cx)
    }

    /// Reads the saved report, or measures again and replaces it.
    fn run_system(&mut self, failure: Message, measure: bool, cx: &mut Context<Self>) {
        if self.system.busy {
            return;
        }
        self.system.busy = true;
        self.system.error = None;
        cx.notify();
        self.background(
            move |app| {
                if measure {
                    app.measure_machine().map(Some)
                } else {
                    app.machine_report()
                }
            },
            move |view, result, cx| {
                let state = &mut view.system;
                state.busy = false;
                match result {
                    Ok(report) => {
                        state.report = report;
                        state.loaded = true;
                    }
                    Err(error) => {
                        errors::report(&error);
                        state.error = Some(failure);
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn system_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let state = &self.system;
        let mut page = page;
        match &state.report {
            Some(report) => {
                page = page
                    .item(hardware(report, locale, cx))
                    .item(self.model_placements(report, locale, cx))
                    .item(details(report, locale, cx));
            }
            None if state.loaded => {
                page = page.item(quiet(text(locale, Message::SysNotMeasured), cx));
            }
            None => {}
        }
        if state.search_installed == Some(false) {
            page = page.footer_action(
                button(
                    ids::SYSTEM_DOWNLOAD,
                    text(locale, Message::DownloadModel),
                    cx,
                )
                .disabled(state.installing)
                .on_click(cx.listener(|this, _, _, cx| this.install_search_model(cx))),
            );
        }
        if state.loaded || state.error.is_some() {
            page =
                page.footer_action(
                    button(
                        ids::SYSTEM_MEASURE_AGAIN,
                        text(locale, Message::MeasureAgain),
                        cx,
                    )
                    .primary()
                    .disabled(state.busy)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.run_system(Message::SysMeasureError, true, cx)
                    })),
                );
        }
        if state.busy {
            page.status(text(locale, Message::StartupMeasuring))
        } else if state.installing {
            page.status(text(locale, Message::DownloadingModel))
        } else if let Some(message) = state.error {
            page.failure(text(locale, message))
        } else {
            page
        }
    }
}
