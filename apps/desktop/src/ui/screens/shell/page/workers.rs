//! Background work, for the whole app: starting the workers once, listening to what they
//! report, and redrawing while a running job is on screen.
//!
//! The database is the source of truth. Job and message events only say *something*
//! changed, and the page on screen reloads it from storage.

use super::*;
use study_app::events::{Heard, JobEvent, MessageEvent};
use study_app::views::{ChatMessage, Job, JobKind};

/// Where starting background work has got to.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) enum WorkersState {
    /// Not asked to start yet.
    #[default]
    Idle,
    Starting,
    Ready,
    /// Could not start; actions that need it say so.
    Failed,
}

/// Whether background work runs, which every page that changes jobs checks first.
#[derive(Default)]
pub(super) struct Workers {
    pub(super) state: WorkersState,
    /// A one-second redraw runs while a running job is on screen.
    ticking: bool,
}

impl Workers {
    /// Background work is still starting: actions wait instead of failing.
    pub(super) fn starting(&self) -> bool {
        matches!(self.state, WorkersState::Idle | WorkersState::Starting)
    }

    /// Background work runs, so messages can be sent and jobs changed.
    pub(super) fn ready(&self) -> bool {
        self.state == WorkersState::Ready
    }

    pub(super) fn failed(&self) -> bool {
        self.state == WorkersState::Failed
    }

    /// Whether an action that needs background work can go ahead. While it is still
    /// starting the action is quietly refused; once it has failed, the page's `error` says
    /// so.
    pub(super) fn allow(&self, error: &mut Option<Message>, cx: &mut Context<AppShell>) -> bool {
        if self.failed() {
            *error = Some(Message::WorkspaceUnavailable);
            cx.notify();
        }
        self.ready()
    }
}

/// What background work reported. Missed events mean anything may have changed.
enum Change {
    Message(MessageEvent),
    Job(JobEvent),
    Missed,
}

impl AppShell {
    /// Starts background work once; queued and interrupted jobs resume right away.
    pub(crate) fn start_workers(&mut self, cx: &mut Context<Self>) {
        if self.workers.state != WorkersState::Idle {
            return;
        }
        self.workers.state = WorkersState::Starting;
        // Listen before starting, so nothing announced meanwhile is missed.
        self.listen_for_changes(cx);
        self.background(
            move |app| app.start_workers(),
            move |view, result, cx| {
                // Only a start still under way reports: a state set meanwhile stands.
                if view.workers.state != WorkersState::Starting {
                    return;
                }
                view.workers.state = match result {
                    Ok(()) => {
                        // A recording posted meanwhile was kept unfinished, and can be
                        // sent now. Nothing else says so before background work has failed.
                        if view.sessions.error == Some(Message::WorkspaceUnavailable) {
                            view.sessions.error = None;
                        }
                        WorkersState::Ready
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        WorkersState::Failed
                    }
                };
                cx.notify();
            },
            cx,
        );
    }

    /// Reloads what is on screen whenever background work reports a change.
    fn listen_for_changes(&mut self, cx: &mut Context<Self>) {
        let bus = self.app.bus();
        let mut messages = bus.listen::<ChatMessage>();
        let mut jobs = bus.listen::<Job>();
        cx.spawn(async move |this, cx| {
            loop {
                let change = tokio::select! {
                    heard = messages.next() => match heard {
                        Heard::Event(event) => Change::Message(event),
                        Heard::Missed => Change::Missed,
                    },
                    heard = jobs.next() => match heard {
                        Heard::Event(event) => Change::Job(event),
                        Heard::Missed => Change::Missed,
                    },
                };
                if this
                    .update(cx, |view, cx| view.on_background_change(change, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }

    /// Whether the page on screen shows a job that is running, whose time keeps counting.
    fn shows_running_job(&self) -> bool {
        match self.active {
            Page::Pipelines => self.pipelines_running(),
            Page::Home => self.dashboard_running(),
            Page::Projects => self.sessions_running(),
            _ => false,
        }
    }

    /// Redraws every second while a running job is on screen, so its time counts up; stops
    /// by itself once none is.
    pub(super) fn keep_time(&mut self, cx: &mut Context<Self>) {
        if self.workers.ticking || !self.shows_running_job() {
            return;
        }
        self.workers.ticking = true;
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(1))
                    .await;
                let running = this.update(cx, |view, cx| {
                    let running = view.shows_running_job();
                    view.workers.ticking = running;
                    if running {
                        cx.notify();
                    }
                    running
                });
                if !matches!(running, Ok(true)) {
                    break;
                }
            }
        })
        .detach();
    }

    /// Routes a change to the page on screen, and to the open session.
    fn on_background_change(&mut self, change: Change, cx: &mut Context<Self>) {
        // A title only renames its session, so the open session needs no reload; the page on
        // screen still does (Home's jobs and recent sessions, Study's scope names).
        let title = if let Change::Job(JobEvent::Changed {
            job_id,
            kind: JobKind::Title,
            status,
            session_id: Some(id),
            ..
        }) = &change
        {
            self.session_title_changed(*id, *job_id, *status, cx);
            cx.notify();
            true
        } else {
            false
        };
        match self.active {
            Page::Pipelines => self.load_pipelines(cx),
            Page::Home => self.load_dashboard(cx),
            // New jobs and finished results change what the Library shows too.
            Page::MediaList => self.load_media(cx),
            // Material being written, and cards it adds.
            Page::Notes | Page::Flashcards | Page::Diagrams => self.load_study(cx),
            // Questions being written, and answers being graded.
            Page::Practice => self.load_practice(cx),
            _ => {}
        }
        let open = self.sessions.session_id();
        let session = match &change {
            Change::Message(MessageEvent::Posted { session_id, .. }) => Some(*session_id),
            Change::Job(event) => event.session_id(),
            Change::Missed => None,
        };
        if !title
            && let Some(id) = open
            && session.is_none_or(|session| session == id)
        {
            self.reload_session(id, cx);
        }
        // A posted message reorders the list by activity. A dropped event may have been a title
        // starting or ending; the jobs say which.
        if !matches!(change, Change::Job(_)) {
            self.load_session_list(cx);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::testing::TempApp;

    #[test]
    fn background_work_starts_on_the_app_database() -> study_core::Result<()> {
        let app = TempApp::new();
        app.start_workers()?;
        assert!(app.workers_running());
        Ok(())
    }
}
