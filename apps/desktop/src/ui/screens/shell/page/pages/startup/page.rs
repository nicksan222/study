//! The first-launch screen shown while Study measures this computer.

use super::ids;
use crate::features::{benchmark, errors};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::progress::Progress as ProgressBar;
use std::time::Duration;
use study_ui::{ContentPage, PageView, button, units};

/// How long a measurement runs before the startup screen appears.
const SHOW_AFTER: Duration = Duration::from_millis(400);

/// Where the one-time measurement of this computer is.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::ui::screens::shell::page) enum Startup {
    /// Nothing to show: already measured, skipped, or never started (tests).
    #[default]
    Idle,
    /// Measuring, but not yet for long enough to be worth a screen: a saved report is read
    /// almost at once.
    Checking,
    /// Measuring for long enough that the screen shows it.
    Running,
    /// The measurement failed; the full error chain is in the log.
    Failed,
}

impl AppShell {
    /// Measures this computer if it has never been measured. A saved report is read in the
    /// background without showing anything.
    pub(crate) fn start_benchmark(&mut self, cx: &mut Context<Self>) {
        if matches!(self.startup, Startup::Checking | Startup::Running) {
            return;
        }
        self.startup = Startup::Checking;
        let run = benchmark::measure(&self.app);
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SHOW_AFTER).await;
            let _ = this.update(cx, |view, cx| {
                if view.startup == Startup::Checking {
                    view.startup = Startup::Running;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.spawn(async move |this, cx| {
            let outcome = benchmark::outcome(run).await;
            let _ = this.update(cx, |view, cx| {
                view.startup = match outcome {
                    Ok(report) => {
                        view.system.set_report(report);
                        Startup::Idle
                    }
                    Err(error) => {
                        errors::report(&error);
                        Startup::Failed
                    }
                };
                cx.notify();
            });
        })
        .detach();
    }

    /// The startup screen, or `None` once there is nothing to wait for.
    pub(in crate::ui::screens::shell::page) fn startup_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<PageView> {
        if matches!(self.startup, Startup::Idle | Startup::Checking) {
            return None;
        }
        let page = ContentPage::new(
            text(locale, Message::StartupTitle),
            text(locale, Message::StartupIntro),
        )
        .icon(IconName::Gauge);
        if self.startup == Startup::Failed {
            return Some(
                page.failure(text(locale, Message::StartupFailed))
                    .footer_action(
                        button(ids::RETRY, text(locale, Message::Retry), cx)
                            .primary()
                            .on_click(cx.listener(|this, _, _, cx| this.start_benchmark(cx))),
                    )
                    .footer_action(
                        button(ids::SKIP, text(locale, Message::StartupSkip), cx).on_click(
                            cx.listener(|this, _, _, cx| {
                                this.startup = Startup::Idle;
                                cx.notify();
                            }),
                        ),
                    )
                    .into(),
            );
        }
        let label = text(locale, Message::StartupMeasuring);
        let unit = units(cx);
        let bar = ProgressBar::new(ids::PROGRESS)
            .accessibility_label(label)
            .loading(true)
            .w_full();
        let progress = div()
            .mt(unit(14.))
            .w_full()
            .max_w(unit(640.))
            .flex()
            .flex_col()
            .gap(unit(8.))
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .font_weight(gpui_kit::FontWeight::MEDIUM)
                    .child(label),
            )
            .child(bar);
        Some(page.item(progress).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::ui::screens::shell::page::testing::{click, find, open_shell};
    use gpui_kit::TestAppContext;

    #[gpui_kit::test]
    fn a_failed_measurement_offers_retry_and_skip_leaves_it(cx: &mut TestAppContext) {
        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        cx.update(|cx| {
            shell.update(cx, |shell, cx| {
                shell.startup = Startup::Failed;
                cx.notify();
            })
        });
        assert!(find(cx, window, ids::RETRY).is_some());
        click(cx, window, ids::SKIP);
        assert_eq!(
            cx.update(|cx| shell.read(cx).startup.clone()),
            Startup::Idle
        );
        assert!(find(cx, window, ids::SKIP).is_none());
    }
}
