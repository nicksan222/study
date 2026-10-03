//! Waiting off the UI thread, for every page: `AppShell::background` runs a blocking call on
//! the app and hands its result back to the shell (`background_each` for a list of them, one
//! at a time, and `background_in_window` for a result that needs the window).
//! `AppShell::act` is `background` for an action whose failure the page shows,
//! `AppShell::change` one that also holds off the page's other changes while it runs,
//! `AppShell::pick_files` waits on the system's file picker, and `Serial` keeps a load or a
//! save from overlapping itself.

use super::AppShell;
use gpui_kit::{Context, PathPromptOptions, Window};
use std::path::PathBuf;
use std::sync::Arc;
use study_localization::{Message, text};

/// What the system's file picker gave back.
pub(super) enum Picked {
    Files(Vec<PathBuf>),
    /// Closed without choosing.
    Dismissed,
    /// The picker could not be shown.
    Failed,
}

/// Work that runs one at a time, such as a page's load or the preferences' save. Asking
/// while it runs queues exactly one more run, so the last one always sees the newest state
/// and an older one can never finish last and win.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Serial {
    running: bool,
    again: bool,
}

impl Serial {
    /// Whether to start a run now. While one runs, this queues another and says no.
    pub(super) fn start(&mut self) -> bool {
        if self.running {
            self.again = true;
            false
        } else {
            self.running = true;
            true
        }
    }

    /// Ends the run; `true` when another was asked for meanwhile, to be started now.
    #[must_use]
    pub(super) fn finish(&mut self) -> bool {
        self.running = false;
        std::mem::take(&mut self.again)
    }

    /// Whether a run is under way.
    pub(super) fn running(&self) -> bool {
        self.running
    }
}

impl AppShell {
    /// Runs `work` with the app on a background thread, then `done` with its result on the
    /// shell. Nothing runs after the shell is gone.
    pub(super) fn background<T: Send + 'static>(
        &self,
        work: impl FnOnce(&study_app::App) -> T + Send + 'static,
        done: impl FnOnce(&mut Self, T, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let app = self.app.clone();
        let work = cx.background_executor().spawn(async move { work(&app) });
        cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| done(view, result, cx));
        })
        .detach();
    }

    /// Runs `action` off the UI thread, then `reload` reloads the page. When it fails, or
    /// returns `false` because what it acts on is gone or cannot take it, `failed` shows in
    /// the page's error (`error` finds it); a failure is logged too. An action whose `false`
    /// is harmless (the job already moved on) maps it to `true`.
    pub(super) fn act(
        &self,
        action: impl FnOnce(&study_app::App) -> study_core::Result<bool> + Send + 'static,
        error: fn(&mut Self) -> &mut Option<Message>,
        failed: Message,
        reload: fn(&mut Self, &mut Context<Self>),
        cx: &mut Context<Self>,
    ) {
        self.background(
            action,
            move |view, result, cx| {
                if acted(result) != Some(true) {
                    *error(view) = Some(failed);
                }
                reload(view, cx);
            },
            cx,
        );
    }

    /// Saves a change off the UI thread while the page's busy flag holds off every other
    /// change, clearing the page's error first (`state` finds both). When it took effect,
    /// `applied` shows it; when it did not, or failed, the page says `failed`, and a failure
    /// is logged. `after` runs either way.
    pub(super) fn change(
        &mut self,
        state: fn(&mut Self) -> (&mut bool, &mut Option<Message>),
        work: impl FnOnce(&study_app::App) -> study_core::Result<bool> + Send + 'static,
        applied: impl FnOnce(&mut Self) + 'static,
        failed: Message,
        after: fn(&mut Self, &mut Context<Self>),
        cx: &mut Context<Self>,
    ) {
        let (busy, error) = state(self);
        *busy = true;
        *error = None;
        cx.notify();
        self.background(
            work,
            move |view, result, cx| {
                let took = acted(result) == Some(true);
                let (busy, error) = state(view);
                *busy = false;
                if took {
                    applied(view);
                } else {
                    *error = Some(failed);
                }
                after(view, cx);
                cx.notify();
            },
            cx,
        );
    }

    /// `background` for each of `items` in turn, so a long list never stalls the app:
    /// `done` takes each result as it comes, and returns whether to go on.
    pub(super) fn background_each<I: Send + 'static, T: Send + 'static>(
        &self,
        items: Vec<I>,
        work: impl Fn(&study_app::App, I) -> T + Send + Sync + 'static,
        done: impl Fn(&mut Self, T, &mut Context<Self>) -> bool + 'static,
        cx: &mut Context<Self>,
    ) {
        let app = self.app.clone();
        let work = Arc::new(work);
        cx.spawn(async move |this, cx| {
            for item in items {
                let (app, work) = (app.clone(), work.clone());
                let result = cx
                    .background_executor()
                    .spawn(async move { work(&app, item) })
                    .await;
                let go_on = this
                    .update(cx, |view, cx| done(view, result, cx))
                    .unwrap_or(false);
                if !go_on {
                    break;
                }
            }
        })
        .detach();
    }

    /// `background`, for a `done` that needs the window, such as to close a dialog or clear
    /// an input. Nothing runs after the window or the shell is gone.
    pub(super) fn background_in_window<T: Send + 'static>(
        &self,
        window: &Window,
        work: impl FnOnce(&study_app::App) -> T + Send + 'static,
        done: impl FnOnce(&mut Self, T, &mut Window, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let app = self.app.clone();
        let handle = window.window_handle();
        let work = cx.background_executor().spawn(async move { work(&app) });
        cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = handle.update(cx, |_, window, cx| {
                let _ = this.update(cx, |view, cx| done(view, result, window, cx));
            });
        })
        .detach();
    }

    /// Asks the system for files, the picker titled `title`, then hands `done` what was
    /// picked. Nothing runs after the window or the shell is gone.
    pub(super) fn pick_files(
        &self,
        title: Message,
        window: &Window,
        done: impl FnOnce(&mut Self, Picked, &mut Window, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some(text(self.preferences.language, title).into()),
        });
        let handle = window.window_handle();
        cx.spawn(async move |this, cx| {
            let picked = match prompt.await {
                Ok(Ok(Some(paths))) => Picked::Files(paths),
                Ok(Ok(None)) => Picked::Dismissed,
                Ok(Err(error)) => {
                    crate::features::errors::report(&error);
                    Picked::Failed
                }
                // The picker went with its window, which then shows nothing.
                Err(_) => Picked::Failed,
            };
            let _ = handle.update(cx, |_, window, cx| {
                let _ = this.update(cx, |view, cx| done(view, picked, window, cx));
            });
        })
        .detach();
    }
}

/// What an action or a read gave back, such as whether an action took effect: `None` when
/// it failed, which is logged here.
pub(super) fn acted<T>(result: study_core::Result<T>) -> Option<T> {
    result
        .inspect_err(|failure| crate::features::errors::report(failure))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::Serial;

    #[test]
    fn a_serial_run_queues_one_more_while_running() {
        let mut serial = Serial::default();
        assert!(serial.start());
        assert!(serial.running());
        // Asked twice meanwhile: one more run, not two.
        assert!(!serial.start());
        assert!(!serial.start());
        assert!(serial.finish());
        assert!(!serial.running());
        assert!(serial.start());
        assert!(!serial.finish());
    }
}
