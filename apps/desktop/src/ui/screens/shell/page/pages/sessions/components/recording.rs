//! Recording audio into a session: the microphone button, the bar shown while recording,
//! and what to do with a recording the app closed on.
//!
//! The recorder saves audio to the database about once a second. Stopping posts the
//! recording as a WAV attachment, which is transcribed like any other.
//! If the app stops while recording, the saved audio waits in the database as an unfinished
//! recording that can be resumed, sent, or discarded.

use super::super::ids;
use super::super::page::SessionView;
use crate::features::recording::{Ended, Recorder};
use crate::ui::screens::shell::AppShell;
use crate::ui::screens::shell::page::Page;
use gpui_kit::assets::IconName;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Icon, button::Button, button::ButtonVariants as _,
};
use gpui_kit::{AnyElement, Context, IntoElement, ParentElement as _, Styled as _, div, relative};
use std::time::Duration;
use study_app::App;
use study_app::views::Recording;
use study_core::{RecordingId, SessionId};
use study_localization::{Locale, Message, recording_clock, text};
use study_ui::{button, icon_button, units};

/// How often the bar's clock and level meter refresh while recording.
const TICK: Duration = Duration::from_millis(200);

/// Where the microphone is at.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) enum RecorderState {
    #[default]
    Idle,
    /// Opening the microphone for a session.
    Starting,
    /// Recording into a session.
    Live(Recorder),
    /// Saving the last audio and posting it to the session.
    Stopping(SessionId),
}

/// The microphone, and the recordings the app closed on.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct RecordingState {
    pub(in crate::ui::screens::shell::page) recorder: RecorderState,
    /// Recordings saved but not posted, other than the live one, newest first.
    pub(in crate::ui::screens::shell::page) unfinished: Vec<Recording>,
    /// The session of the unfinished recording being sent or discarded.
    busy: Option<SessionId>,
    /// Whether a session with an unfinished recording has already been opened by itself.
    offered: bool,
}

impl RecordingState {
    /// The session being recorded into, if any.
    pub(in crate::ui::screens::shell::page) fn live_session(&self) -> Option<SessionId> {
        match &self.recorder {
            RecorderState::Live(recorder) => Some(recorder.session_id()),
            _ => None,
        }
    }

    /// The session a recording is going into: recorded into, posted to as it stops, or
    /// sent to or discarded from while unfinished. Deleting it, or its project, would
    /// take the recording with it.
    pub(in crate::ui::screens::shell::page) fn session_in_use(&self) -> Option<SessionId> {
        match &self.recorder {
            RecorderState::Live(recorder) => Some(recorder.session_id()),
            RecorderState::Stopping(session_id) => Some(*session_id),
            RecorderState::Idle | RecorderState::Starting => self.busy,
        }
    }

    pub(in crate::ui::screens::shell::page) fn idle(&self) -> bool {
        matches!(self.recorder, RecorderState::Idle) && self.busy.is_none()
    }
}

impl AppShell {
    /// Reloads the unfinished recordings. The first time any are found while the projects page
    /// shows no session, the newest one's session opens so the recording is not forgotten.
    pub(in crate::ui::screens::shell::page) fn load_recordings(&mut self, cx: &mut Context<Self>) {
        self.background(
            |app| app.recordings(),
            |view, result, cx| {
                let recordings = match result {
                    Ok(recordings) => recordings,
                    // The bar for unfinished recordings is a reminder; the page works without it.
                    Err(error) => return crate::features::errors::report(&error),
                };
                let state = &mut view.sessions.recording;
                let live = match &state.recorder {
                    RecorderState::Live(recorder) => Some(recorder.recording_id()),
                    _ => None,
                };
                state.unfinished = recordings
                    .into_iter()
                    .filter(|recording| Some(recording.id) != live)
                    .collect();
                let first = state.unfinished.first().map(|r| r.session_id);
                // Offered once, where sessions are shown, before anything else is opened.
                if view.active == Page::Projects
                    && !std::mem::replace(&mut view.sessions.recording.offered, true)
                    && let Some(session_id) = first
                    && matches!(view.sessions.view, SessionView::Draft { .. })
                    && view.sessions.session(session_id).is_some()
                {
                    view.show_project_session();
                    view.switch_session(session_id, cx);
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Whether a recording can start here now: nothing recording or finishing, somewhere
    /// to put it, and the sessions open for edits.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn can_start_recording(&self) -> bool {
        let state = &self.sessions.recording;
        matches!(state.recorder, RecorderState::Idle)
            && state.busy.is_none()
            && state.live_session().is_none()
            && self.sessions.has_target()
            && self.sessions.can_edit()
    }

    pub(in crate::ui::screens::shell::page::pages::sessions) fn start_recording(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        if !self.sessions.recording.idle() || !self.sessions.can_edit() {
            return;
        }
        let locale = self.preferences.language;
        let Some(target) = self
            .sessions
            .target(|| text(locale, Message::RecordingSessionTitle).to_owned())
        else {
            return;
        };
        self.sessions.recording.recorder = RecorderState::Starting;
        self.sessions.error = None;
        cx.notify();
        let app = self.app.clone();
        let start = cx.background_executor().spawn(async move {
            // Which step failed decides what the page says: saving, or the microphone.
            let mut step = Message::SessionsSaveError;
            target
                .write(&app, |session_id| {
                    step = Message::RecordingSaveError;
                    let recording = app.create_recording(session_id)?;
                    step = Message::MicrophoneError;
                    Recorder::start(app.clone(), &recording).inspect_err(|_| {
                        // Leave nothing behind for a microphone that never opened.
                        if let Err(error) = app.delete_recording(recording.id) {
                            crate::features::errors::report(&error);
                        }
                    })
                })
                .map_err(|error| (step, error))
        });
        self.run_recorder(start, cx);
    }

    /// Continues an unfinished recording where its saved audio ends.
    fn resume_recording(&mut self, recording_id: RecordingId, cx: &mut Context<Self>) {
        if !self.sessions.recording.idle() || !self.sessions.can_edit() {
            return;
        }
        self.sessions.recording.recorder = RecorderState::Starting;
        self.sessions.error = None;
        cx.notify();
        let app = self.app.clone();
        let start = cx.background_executor().spawn(async move {
            Recorder::resume(app, recording_id).map_err(|error| (Message::MicrophoneError, error))
        });
        self.run_recorder(start, cx);
    }

    /// Shows the recorder once the microphone is open, then keeps its bar up to date until
    /// it stops, stopping it here if it ends by itself. A failed start says what to show.
    fn run_recorder(
        &mut self,
        start: gpui_kit::Task<Result<Recorder, (Message, study_core::Error)>>,
        cx: &mut Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            let result = start.await;
            let started = this
                .update(cx, |view, cx| {
                    let started = match result {
                        Ok(recorder) => {
                            let session_id = recorder.session_id();
                            view.sessions.recording.recorder = RecorderState::Live(recorder);
                            // No window here; the composer catches up at the next render.
                            view.switch_session(session_id, cx);
                            true
                        }
                        Err((message, error)) => {
                            crate::features::errors::report(&error);
                            view.sessions.recording.recorder = RecorderState::Idle;
                            view.sessions.error = Some(message);
                            false
                        }
                    };
                    view.load_session_list(cx);
                    view.load_recordings(cx);
                    cx.notify();
                    started
                })
                .unwrap_or(false);
            if !started {
                return;
            }
            loop {
                cx.background_executor().timer(TICK).await;
                let live = this.update(cx, |view, cx| {
                    let RecorderState::Live(recorder) = &view.sessions.recording.recorder else {
                        return false;
                    };
                    if recorder.has_ended() {
                        view.stop_recording(cx);
                        return false;
                    }
                    cx.notify();
                    true
                });
                if !matches!(live, Ok(true)) {
                    break;
                }
            }
        })
        .detach();
    }

    /// Stops the microphone and posts what was recorded. A recording the microphone or the
    /// database cut short is kept as unfinished instead.
    pub(in crate::ui::screens::shell::page) fn stop_recording(&mut self, cx: &mut Context<Self>) {
        let state = std::mem::take(&mut self.sessions.recording.recorder);
        let RecorderState::Live(recorder) = state else {
            self.sessions.recording.recorder = state;
            return;
        };
        let session_id = recorder.session_id();
        self.sessions.recording.recorder = RecorderState::Stopping(session_id);
        cx.notify();
        let recording_id = recorder.recording_id();
        let locale = self.preferences.language;
        self.background(
            move |app| {
                ended_message(recorder.stop(), || {
                    post_recording(app, session_id, recording_id, locale)
                })
            },
            move |view, message, cx| {
                view.sessions.recording.recorder = RecorderState::Idle;
                if let Some(message) = message {
                    view.sessions.fail_in(session_id, message);
                }
                view.after_recording_change(session_id, cx);
            },
            cx,
        );
    }

    /// Posts an unfinished recording as it is.
    fn send_unfinished(&mut self, recording: Recording, cx: &mut Context<Self>) {
        if self.sessions.recording.busy.is_some() {
            return;
        }
        self.sessions.recording.busy = Some(recording.session_id);
        self.sessions.error = None;
        cx.notify();
        let locale = self.preferences.language;
        self.background(
            move |app| post_recording(app, recording.session_id, recording.id, locale),
            move |view, result, cx| {
                view.sessions.recording.busy = None;
                view.sessions.error = result.err();
                view.after_recording_change(recording.session_id, cx);
            },
            cx,
        );
    }

    fn discard_unfinished(&mut self, recording: Recording, cx: &mut Context<Self>) {
        if self.sessions.recording.busy.is_some() {
            return;
        }
        self.sessions.recording.busy = Some(recording.session_id);
        self.sessions.error = None;
        cx.notify();
        let (recording_id, session_id) = (recording.id, recording.session_id);
        self.background(
            move |app| app.delete_recording(recording_id),
            move |view, result, cx| {
                view.sessions.recording.busy = None;
                if let Err(error) = &result {
                    crate::features::errors::report(error);
                    view.sessions.error = Some(Message::RecordingSaveError);
                }
                view.after_recording_change(session_id, cx);
            },
            cx,
        );
    }

    fn after_recording_change(&mut self, session_id: SessionId, cx: &mut Context<Self>) {
        self.load_recordings(cx);
        self.load_session_list(cx);
        if self.sessions.session_id() == Some(session_id) {
            self.sessions.scroll_to_end = true;
            self.load_messages(session_id, cx);
        }
        cx.notify();
    }

    /// The composer's microphone button: starts recording, or stops the recording here.
    pub(in crate::ui::screens::shell::page) fn record_button(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Button {
        let state = &self.sessions.recording;
        let here = self.sessions.session_id();
        if let Some(session_id) = state.live_session() {
            if Some(session_id) == here {
                return icon_button(
                    ids::RECORD,
                    text(locale, Message::StopRecording),
                    IconName::Square,
                    cx,
                )
                .danger()
                .on_click(cx.listener(|this, _, _, cx| this.stop_recording(cx)));
            }
            return icon_button(
                ids::RECORD,
                text(locale, Message::RecordingElsewhere),
                IconName::Mic,
                cx,
            )
            .disabled(true);
        }
        let starting = !matches!(state.recorder, RecorderState::Idle);
        icon_button(
            ids::RECORD,
            text(locale, Message::StartRecording),
            IconName::Mic,
            cx,
        )
        .loading(starting)
        .disabled(
            starting
                || state.busy.is_some()
                || !self.sessions.has_target()
                || !self.sessions.can_edit(),
        )
        .on_click(cx.listener(|this, _, _, cx| this.start_recording(cx)))
    }

    /// What sits above the composer about recording in the open session: the live bar, or
    /// the unfinished recording with what can be done with it.
    pub(in crate::ui::screens::shell::page) fn recording_shelf(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let session_id = self.sessions.session_id()?;
        let state = &self.sessions.recording;
        if let RecorderState::Live(recorder) = &state.recorder
            && recorder.session_id() == session_id
        {
            return Some(self.live_bar(recorder.seconds(), recorder.level(), locale, cx));
        }
        let recording = state
            .unfinished
            .iter()
            .find(|recording| recording.session_id == session_id)?
            .clone();
        Some(self.unfinished_bar(recording, locale, cx))
    }

    fn live_bar(
        &self,
        seconds: u64,
        level: f32,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let colors = cx.theme().colors;
        div()
            .w_full()
            .flex()
            .items_center()
            .gap(unit(10.))
            .child(div().size(unit(10.)).rounded_full().bg(colors.danger))
            .child(div().child(text(locale, Message::RecordingLive)))
            .child(
                div()
                    .text_color(colors.muted_foreground)
                    .child(recording_clock(seconds)),
            )
            .child(
                div()
                    .flex_1()
                    .max_w(unit(160.))
                    .h(unit(4.))
                    .rounded_full()
                    .bg(colors.foreground.opacity(0.08))
                    .child(
                        div()
                            .h_full()
                            // The square root lifts quiet speech, so the meter moves.
                            .w(relative(level.sqrt()))
                            .rounded_full()
                            .bg(colors.danger),
                    ),
            )
            .into_any_element()
    }

    fn unfinished_bar(
        &self,
        recording: Recording,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let state = &self.sessions.recording;
        let can_act = state.idle() && self.sessions.can_edit();
        let resume = recording.id;
        let send = recording.clone();
        let discard = recording.clone();
        div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(10.))
            .child(
                Icon::new(IconName::Mic)
                    .size(unit(16.))
                    .text_color(colors.muted_foreground),
            )
            .child(div().child(text(locale, Message::RecordingInterrupted)))
            .child(
                div()
                    .text_color(colors.muted_foreground)
                    .child(recording_clock(recording.seconds())),
            )
            .child(div().flex_1())
            .child(
                button(
                    ids::RESUME_RECORDING,
                    text(locale, Message::ResumeRecording),
                    cx,
                )
                .icon(IconName::Mic)
                .disabled(!can_act)
                .on_click(cx.listener(move |this, _, _, cx| this.resume_recording(resume, cx))),
            )
            .child(
                button(
                    ids::SEND_RECORDING,
                    text(locale, Message::SendRecording),
                    cx,
                )
                .primary()
                .loading(state.busy.is_some())
                .disabled(!can_act || recording.samples == 0)
                .on_click(
                    cx.listener(move |this, _, _, cx| this.send_unfinished(send.clone(), cx)),
                ),
            )
            .child(
                button(
                    ids::DISCARD_RECORDING,
                    text(locale, Message::DiscardRecording),
                    cx,
                )
                .ghost()
                .disabled(!can_act)
                .on_click(
                    cx.listener(move |this, _, _, cx| this.discard_unfinished(discard.clone(), cx)),
                ),
            )
            .into_any_element()
    }
}

/// What the session shows once the microphone has stopped: the failure, or how posting what
/// was recorded went. A recording the microphone or the database cut short is not posted.
fn ended_message(ended: Ended, post: impl FnOnce() -> Result<(), Message>) -> Option<Message> {
    match ended {
        Ended::Failed(error) => {
            crate::features::errors::report(&error);
            Some(Message::RecordingFailed)
        }
        ended => match post() {
            Ok(()) if matches!(ended, Ended::Full) => Some(Message::RecordingFull),
            Ok(()) => None,
            Err(message) => Some(message),
        },
    }
}

/// Posts a saved recording to its session, named after when it started. A recording with no
/// audio is simply removed. Blocks on the database.
fn post_recording(
    app: &App,
    session_id: SessionId,
    recording_id: RecordingId,
    locale: Locale,
) -> Result<(), Message> {
    let failed = |error: study_core::Error| {
        crate::features::errors::report(&error);
        Message::RecordingSaveError
    };
    let Some(recording) = app.recording(recording_id).map_err(failed)? else {
        return Ok(());
    };
    if recording.samples == 0 {
        app.delete_recording(recording_id).map_err(failed)?;
        return Ok(());
    }
    if !app.workers_running() {
        return Err(Message::WorkspaceUnavailable);
    }
    let name = crate::features::clock::recording_file_name(locale, recording.started_at);
    app.post_recording(session_id, recording_id, &name)
        .map_err(failed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::testing::{TempApp, open_shell};

    #[test]
    fn restart_waits_for_microphone_start_and_stop() {
        let mut state = RecordingState::default();
        assert!(state.idle());
        state.recorder = RecorderState::Starting;
        assert!(!state.idle());
        state.recorder = RecorderState::Stopping(SessionId::new(1));
        assert!(!state.idle());
        state.recorder = RecorderState::Idle;
        state.busy = Some(SessionId::new(1));
        assert!(!state.idle());
    }

    #[test]
    fn a_failed_recording_says_so_without_posting() {
        let failed = Ended::Failed(study_core::Error::msg("the microphone went away"));
        let message = ended_message(failed, || panic!("a failed recording is not posted"));
        assert_eq!(message, Some(Message::RecordingFailed));
    }

    #[test]
    fn a_full_recording_is_posted_and_says_it_is_full() {
        assert_eq!(
            ended_message(Ended::Full, || Ok(())),
            Some(Message::RecordingFull)
        );
    }

    #[test]
    fn a_stopped_recording_is_posted_quietly_or_says_why_not() {
        assert_eq!(ended_message(Ended::Stopped, || Ok(())), None);
        assert_eq!(
            ended_message(Ended::Stopped, || Err(Message::WorkspaceUnavailable)),
            Some(Message::WorkspaceUnavailable)
        );
    }

    #[test]
    fn posting_a_recording_with_no_audio_deletes_it() -> study_core::Result<()> {
        let app = TempApp::new();
        let project = app.create_project("Biology")?;
        let session = app.create_session(project.id, "Lecture")?;
        let recording = app.create_recording(session.id)?;
        let posted = post_recording(&app, session.id, recording.id, Locale::English);
        assert_eq!(posted, Ok(()));
        assert!(app.recording(recording.id)?.is_none());
        Ok(())
    }

    #[test]
    fn posting_a_recording_with_the_workers_off_says_the_workspace_is_unavailable()
    -> study_core::Result<()> {
        let app = TempApp::new();
        let project = app.create_project("Biology")?;
        let session = app.create_session(project.id, "Lecture")?;
        let recording = app.create_recording(session.id)?;
        app.append_recording(recording.id, &[1; 160])?;
        assert!(!app.workers_running());
        let posted = post_recording(&app, session.id, recording.id, Locale::English);
        assert_eq!(posted, Err(Message::WorkspaceUnavailable));
        assert!(app.recording(recording.id)?.is_some());
        Ok(())
    }

    /// A recording stopping is still being posted to its session, and an unfinished one
    /// being sent or discarded still belongs to its own; neither session, nor its project,
    /// can be deleted until that is done.
    #[gpui_kit::test]
    fn a_recording_on_its_way_holds_off_deleting_its_session_and_project(
        cx: &mut gpui_kit::TestAppContext,
    ) {
        let app = TempApp::new();
        let database = app.database();
        let project = database.create_project("Biology").unwrap();
        let other = database.create_project("Chemistry").unwrap();
        let session = database.create_session(project.id, "Lecture").unwrap();
        let (_window, shell) = open_shell(cx, app.app(), Preferences::default());
        cx.update(|cx| shell.update(cx, |shell, cx| shell.load_session_list(cx)));
        cx.run_until_parked();
        let deletable = |cx: &mut gpui_kit::TestAppContext| {
            cx.update(|cx| {
                let sessions = &shell.read(cx).sessions;
                (
                    sessions.can_delete(session.id),
                    sessions.can_delete_project(project.id),
                    sessions.can_delete_project(other.id),
                )
            })
        };
        assert_eq!(deletable(cx), (true, true, true));

        let set = |cx: &mut gpui_kit::TestAppContext, recorder, busy| {
            cx.update(|cx| {
                shell.update(cx, |shell, _| {
                    shell.sessions.recording.recorder = recorder;
                    shell.sessions.recording.busy = busy;
                })
            })
        };
        set(cx, RecorderState::Stopping(session.id), None);
        assert_eq!(deletable(cx), (false, false, true));
        set(cx, RecorderState::Idle, Some(session.id));
        assert_eq!(deletable(cx), (false, false, true));
        set(cx, RecorderState::Idle, None);
        assert_eq!(deletable(cx), (true, true, true));
    }
}
