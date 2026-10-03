//! Explicit checks and signed update installation. Installation owns the window until it
//! finishes, so a new recording or edit cannot begin while the executable is replaced.

use super::super::ids;
use super::{setting_row, with_status};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{Disableable as _, Sizable as _};
use study_app::updates;
use study_ui::{ContentPage, button};

#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct UpdatesState {
    available: Option<updates::AvailableUpdate>,
    checking: bool,
    installing: bool,
    notice: Option<(Message, bool)>,
}

impl UpdatesState {
    pub(in crate::ui::screens::shell::page) fn installing(&self) -> bool {
        self.installing
    }
}

impl AppShell {
    fn update_install_allowed(&self) -> bool {
        self.sessions.recording.idle() && self.sessions.can_edit() && !self.saving.running()
    }

    fn check_update(&mut self, cx: &mut Context<Self>) {
        if !updates::configured() || self.updates.checking || self.updates.installing {
            return;
        }
        self.updates.checking = true;
        self.updates.available = None;
        self.updates.notice = Some((Message::UpdateChecking, false));
        cx.notify();
        let check = self.app.spawn(updates::check());
        cx.spawn(async move |this, cx| {
            let result = check.await;
            let _ = this.update(cx, |view, cx| {
                view.updates.checking = false;
                view.updates.notice = Some(match result {
                    Ok(Ok(available)) => {
                        let message = if available.is_some() {
                            Message::UpdateReady
                        } else {
                            Message::UpdateCurrent
                        };
                        view.updates.available = available;
                        (message, false)
                    }
                    Ok(Err(error)) => {
                        crate::features::errors::report(&error);
                        (Message::UpdateFailed, true)
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        (Message::UpdateFailed, true)
                    }
                });
                cx.notify();
            });
        })
        .detach();
    }

    fn install_update(&mut self, cx: &mut Context<Self>) {
        if self.updates.installing || self.updates.checking || !self.update_install_allowed() {
            return;
        }
        let Some(update) = self.updates.available.clone() else {
            return;
        };
        self.updates.installing = true;
        cx.notify();
        let install = self.app.spawn(async move { update.install().await });
        cx.spawn(async move |this, cx| {
            let result = install.await;
            let _ = this.update(cx, |view, cx| {
                let installed = match result {
                    Ok(Ok(())) => true,
                    Ok(Err(error)) => {
                        crate::features::errors::report(&error);
                        false
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        false
                    }
                };
                if installed {
                    match updates::restart() {
                        Ok(()) => {
                            cx.quit();
                            return;
                        }
                        Err(error) => crate::features::errors::report(&error),
                    }
                }
                view.updates.installing = false;
                view.updates.notice = Some((Message::UpdateFailed, true));
                cx.notify();
            });
        })
        .detach();
    }

    pub(in crate::ui::screens::shell::page) fn updates_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let check = button(ids::UPDATE_CHECK, text(locale, Message::UpdateCheck), cx)
            .small()
            .disabled(!updates::configured() || self.updates.checking)
            .on_click(cx.listener(|this, _, _, cx| this.check_update(cx)));
        let unavailable =
            (!updates::configured()).then(|| text(locale, Message::UpdateUnavailable).into());
        let page = page.item(setting_row(updates::VERSION, unavailable, check, cx));
        if !updates::configured() {
            return page;
        }
        let page = if let Some(update) = &self.updates.available {
            let install = button(
                ids::UPDATE_INSTALL,
                text(locale, Message::UpdateInstall),
                cx,
            )
            .small()
            .disabled(!self.update_install_allowed())
            .on_click(cx.listener(|this, _, _, cx| this.install_update(cx)));
            page.item(setting_row(update.version.clone(), None, install, cx))
        } else {
            page
        };
        let notice = if self.updates.available.is_some() && !self.update_install_allowed() {
            Some((Message::UpdateBusy, false))
        } else {
            self.updates.notice
        };
        with_status(page, locale, notice)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::ui::screens::shell::page::testing::{click, open_shell};
    use gpui_kit::TestAppContext;

    #[gpui_kit::test]
    fn installing_waits_for_preferences_to_be_saved(cx: &mut TestAppContext) {
        let temp = crate::testing::TempApp::new();
        let (_, shell) = open_shell(cx, temp.app(), Preferences::default());
        cx.update(|cx| {
            shell.update(cx, |shell, _| {
                assert!(shell.update_install_allowed());
                assert!(shell.saving.start());
                assert!(!shell.update_install_allowed());
                let _ = shell.saving.finish();
                assert!(shell.update_install_allowed());
            });
        });
    }

    #[gpui_kit::test]
    fn development_build_cannot_start_an_update(cx: &mut TestAppContext) {
        if updates::configured() {
            return;
        }
        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        click(cx, window, Page::Settings as usize);
        click(cx, window, ids::SECTION + SettingsSection::Updates as usize);
        click(cx, window, ids::UPDATE_CHECK);
        cx.update(|cx| {
            let shell = shell.read(cx);
            assert_eq!(shell.settings_section, SettingsSection::Updates);
            assert!(!shell.updates.checking);
            assert!(!shell.updates.installing());
            assert!(shell.updates.available.is_none());
        });
    }
}
