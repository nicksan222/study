//! Study sessions: a conversation per project. Posting a message reads its files and, for a
//! question, writes an answer that cites them, all as background jobs.
//!
//! Every attachment on the timeline opens a thread beside it, as in a chat app: the file and
//! what was read from it first, then notes, files and answers about it.
//!
//! The page reloads a session from storage whenever background work reports a change in it
//! (see `workers.rs` in the shell). The pieces it draws live in `components/`.

use super::components::{
    CorrectionState, MentionPicker, RecordingState, ThreadState, VersionsState, chip_mentions,
};
use super::ids;
use crate::features::media::{AttachmentInfo, PastedImages, prepare_attachment};
use crate::features::sessions::derive_title;
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _,
    input::{InputEvent, TextareaState},
};
use gpui_kit::{
    AppContext as _, ClipboardEntry, ClipboardItem, Entity, ExternalPaths, ScrollHandle,
    StatefulInteractiveElement as _, Subscription, Window,
};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};
use study_app::views::{
    Anchor, ChatMessage, ChatSession, JobStatus, MessagePart, PartContent, Project,
};
use study_core::{ErrorKind, JobId, MessageId, PartId, ProjectId, SessionId, SourceId};
use study_ui::{PageFrame, PageHeader, PageView, button, icon_button};

/// What the sessions page shows.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::ui::screens::shell::page) enum SessionView {
    /// Composing the first message of a new session in a project.
    Draft {
        project_id: Option<ProjectId>,
    },
    Open(SessionId),
    /// Asking whether to delete a session, in an alert over its conversation.
    ConfirmDelete(SessionId),
}

impl SessionView {
    /// The session on screen; `None` for a new one.
    pub(in crate::ui::screens::shell::page) fn session(self) -> Option<SessionId> {
        match self {
            Self::Open(id) | Self::ConfirmDelete(id) => Some(id),
            Self::Draft { .. } => None,
        }
    }
}

/// What fills the panel beside the conversation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::ui::screens::shell::page) enum SidePanel {
    /// An attached file's details.
    File(SourceId),
    /// The thread under an attachment.
    Thread(PartId),
}

/// The key that pastes, with Ctrl (⌘ on macOS), as GPUI names it.
const PASTE_KEY: &str = "v";
/// The key that leaves a composer, as GPUI names it.
const ESCAPE_KEY: &str = "escape";
/// The key that moves the keyboard on from a composer, as GPUI names it.
const TAB_KEY: &str = "tab";

/// A note being written in the composer, kept while another session is on screen: its
/// text as notes store it (mentions by kind, so the locale can change meanwhile) and its
/// files.
#[derive(Default)]
struct Unsent {
    text: String,
    attachments: Vec<PathBuf>,
}

/// The sessions page: the list of sessions, the one on screen, and its composer.
pub(in crate::ui::screens::shell::page) struct SessionsState {
    pub(in crate::ui::screens::shell::page) projects: Vec<Project>,
    pub(in crate::ui::screens::shell::page) sessions: Vec<ChatSession>,
    pub(in crate::ui::screens::shell::page) view: SessionView,
    pub(in crate::ui::screens::shell::page) messages: Vec<ChatMessage>,
    /// Which session `messages` belongs to.
    pub(in crate::ui::screens::shell::page) messages_for: Option<SessionId>,
    pub(in crate::ui::screens::shell::page) list_loaded: bool,
    list_loading: Serial,
    pub(in crate::ui::screens::shell::page) messages_loading: bool,
    /// Only the newest message load may apply its result.
    message_generation: u64,
    pub(in crate::ui::screens::shell::page) sending: bool,
    picking: bool,
    busy: bool,
    pub(in crate::ui::screens::shell::page) attachments: Vec<PathBuf>,
    pub(in crate::ui::screens::shell::page) composer: Entity<TextareaState>,
    composer_locale: Option<Locale>,
    pub(in crate::ui::screens::shell::page) scroll: ScrollHandle,
    pub(in crate::ui::screens::shell::page) scroll_to_end: bool,
    pub(in crate::ui::screens::shell::page) expanded: HashSet<JobId>,
    /// Size and preview of each attached file shown, by media id.
    pub(in crate::ui::screens::shell::page) shown: HashMap<SourceId, AttachmentInfo>,
    /// Only the newest round of `load_attachment_previews` may keep preparing previews.
    preview_generation: u64,
    pub(in crate::ui::screens::shell::page) panel: Option<SidePanel>,
    /// The open thread, and the reply being written in it.
    pub(in crate::ui::screens::shell::page) thread: ThreadState,
    /// A block of a file's read text being corrected in its side panel.
    pub(in crate::ui::screens::shell::page) correction: CorrectionState,
    /// Entries' versions: the AI edit menu, editing in place, what the switchers say.
    pub(in crate::ui::screens::shell::page) versions: VersionsState,
    /// Sessions whose title is being generated anew at the user's request.
    pub(in crate::ui::screens::shell::page) titling: HashSet<SessionId>,
    /// The mentions offered while one is typed in `composer`.
    pub(in crate::ui::screens::shell::page) picker: MentionPicker,
    /// The place a citation opened the file panel at, whose blocks then show first, marked.
    pub(in crate::ui::screens::shell::page) cited: Option<(SourceId, Anchor)>,
    /// The text before the cited place shows too; the place stays marked.
    pub(in crate::ui::screens::shell::page) cited_earlier: bool,
    /// What was typed and attached but not sent in each session (and, under `None`, for a
    /// new one) while another is on screen.
    unsent: HashMap<Option<SessionId>, Unsent>,
    /// The composer still holds what is not the view's own: what was written in a session
    /// that is gone, or what was kept already when a session opened without a window. The
    /// next swap or render, which has the window, discards it.
    composer_stale: bool,
    /// Images pasted into a composer, saved until they are sent.
    pasted: PastedImages,
    /// Lets the picker take the arrow keys, Enter, Tab and Escape before the composer does.
    _picker_keys: Subscription,
    /// The note or answer whose deletion is waiting to be confirmed.
    pub(in crate::ui::screens::shell::page) deleting: Option<MessageId>,
    /// The note or answer just copied, which its button says.
    pub(in crate::ui::screens::shell::page) copied: Option<MessageId>,
    pub(in crate::ui::screens::shell::page) error: Option<Message>,
    pub(in crate::ui::screens::shell::page) recording: RecordingState,
    _composer_subscription: Subscription,
}

impl SessionsState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let composer = cx.new(|cx| TextareaState::new(window, cx).submit_on_enter(true));
        let subscription = cx.subscribe_in(
            &composer,
            window,
            |this, input, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { shift: false, .. } => this.send_message(window, cx),
                InputEvent::Change => {
                    chip_mentions(input, window, cx);
                    this.sessions.picker.refresh(input, cx);
                    cx.notify()
                }
                _ => {}
            },
        );
        // Before any key binding, so Enter picks a mention rather than sending the note.
        let shell = cx.weak_entity();
        let picker_keys = cx.intercept_keystrokes(move |event, window, cx| {
            let used = shell
                .update(cx, |shell, cx| {
                    shell.composer_key(&event.keystroke, window, cx)
                })
                .unwrap_or(false);
            if used {
                cx.stop_propagation();
            }
        });
        Self {
            projects: Vec::new(),
            sessions: Vec::new(),
            view: SessionView::Draft { project_id: None },
            messages: Vec::new(),
            messages_for: None,
            list_loaded: false,
            list_loading: Serial::default(),
            messages_loading: false,
            message_generation: 0,
            sending: false,
            picking: false,
            busy: false,
            attachments: Vec::new(),
            composer,
            composer_locale: None,
            scroll: ScrollHandle::new(),
            scroll_to_end: false,
            expanded: HashSet::new(),
            shown: HashMap::new(),
            preview_generation: 0,
            panel: None,
            thread: ThreadState::new(window, cx),
            correction: CorrectionState::new(window, cx),
            versions: VersionsState::new(window, cx),
            titling: HashSet::new(),
            picker: MentionPicker::default(),
            cited: None,
            cited_earlier: false,
            unsent: HashMap::new(),
            composer_stale: false,
            pasted: PastedImages::default(),
            _picker_keys: picker_keys,
            deleting: None,
            copied: None,
            error: None,
            recording: RecordingState::default(),
            _composer_subscription: subscription,
        }
    }

    /// What the transcript marks on its rows.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn row_marks(
        &self,
        chatgpt: crate::ui::screens::shell::page::pages::components::ChatGptState,
    ) -> super::components::RowMarks<'_> {
        super::components::RowMarks {
            deleting: self.deleting,
            copied: self.copied,
            chatgpt,
            versions: &self.versions,
        }
    }

    /// The session on screen, if any.
    pub(in crate::ui::screens::shell::page) fn session_id(&self) -> Option<SessionId> {
        self.view.session()
    }

    /// Shows `message` when `session_id` is still the session on screen, so a late failure
    /// from one the user has left says nothing on another's page.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn fail_in(
        &mut self,
        session_id: SessionId,
        message: Message,
    ) {
        if self.session_id() == Some(session_id) {
            self.error = Some(message);
        }
    }

    pub(in crate::ui::screens::shell::page) fn session(
        &self,
        id: SessionId,
    ) -> Option<&ChatSession> {
        self.sessions.iter().find(|session| session.id == id)
    }

    pub(in crate::ui::screens::shell::page) fn can_edit(&self) -> bool {
        !self.sending && !self.picking && !self.busy
    }

    /// Whether session `id` can be deleted: not while a recording is going into it, which
    /// the database would delete with it.
    pub(in crate::ui::screens::shell::page) fn can_delete(&self, id: SessionId) -> bool {
        self.can_edit() && self.recording.session_in_use() != Some(id)
    }

    /// Whether project `id` can be deleted: not while a recording is going into one of its
    /// sessions, which the database would delete with it. A session not listed yet (just
    /// made for the recording) could be anywhere, so it holds off every project.
    pub(in crate::ui::screens::shell::page) fn can_delete_project(&self, id: ProjectId) -> bool {
        self.recording
            .session_in_use()
            .is_none_or(|session| self.session(session).is_some_and(|s| s.project_id != id))
    }

    /// Whether what is on screen can take a message or a recording: an open session, or a
    /// draft with a project.
    pub(in crate::ui::screens::shell::page) fn has_target(&self) -> bool {
        matches!(
            self.view,
            SessionView::Open(_)
                | SessionView::Draft {
                    project_id: Some(_)
                }
        )
    }

    /// Where a message or a recording made now goes, naming a new session `new_title()`;
    /// `None` when [`has_target`](Self::has_target) is false.
    pub(super) fn target(&self, new_title: impl FnOnce() -> String) -> Option<SessionTarget> {
        match self.view {
            SessionView::Open(id) => Some(SessionTarget::Existing(id)),
            SessionView::Draft {
                project_id: Some(project_id),
            } => Some(SessionTarget::New {
                project_id,
                title: new_title(),
            }),
            SessionView::Draft { project_id: None } | SessionView::ConfirmDelete(_) => None,
        }
    }

    /// The thread the side panel shows, if it shows one.
    pub(in crate::ui::screens::shell::page) fn open_thread(&self) -> Option<PartId> {
        match self.panel {
            Some(SidePanel::Thread(root)) => Some(root),
            Some(SidePanel::File(_)) | None => None,
        }
    }

    /// Every part on screen: the timeline's, then the open thread's replies'.
    pub(in crate::ui::screens::shell::page) fn shown_parts(
        &self,
    ) -> impl Iterator<Item = &MessagePart> {
        let replies = self
            .open_thread()
            .and_then(|root| self.thread.showing(root))
            .map(|thread| thread.replies.as_slice())
            .unwrap_or_default();
        self.messages
            .iter()
            .chain(replies)
            .flat_map(|message| &message.parts)
    }

    /// Closes the side panel; a reply being written in its thread stays for next time.
    fn close_panel(&mut self) {
        self.panel = None;
    }
}

/// Where a message or a recording goes: an open session, or a new one made for it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum SessionTarget {
    Existing(SessionId),
    New {
        project_id: ProjectId,
        title: String,
    },
}

impl SessionTarget {
    /// Runs `write` in the target session, making the session first when it is new. A session
    /// made here is deleted again when `write` fails, so a failure leaves nothing behind.
    /// Blocks on the database.
    pub(super) fn write<T>(
        self,
        app: &study_app::App,
        write: impl FnOnce(SessionId) -> study_core::Result<T>,
    ) -> study_core::Result<T> {
        let (session_id, created) = match self {
            Self::Existing(id) => (id, false),
            // The title stands in until the title agent names the session.
            Self::New { project_id, title } => {
                (app.create_untitled_session(project_id, &title)?.id, true)
            }
        };
        write(session_id).inspect_err(|_| {
            if created && let Err(error) = app.delete_session(session_id) {
                // The write's own failure is what the page shows; this one is only logged.
                crate::features::errors::report(&error);
            }
        })
    }
}

impl AppShell {
    /// Reloads the open session; the list beside it comes with the projects
    /// (`ensure_projects_loaded`).
    pub(in crate::ui::screens::shell::page) fn enter_sessions(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.sessions.session_id() {
            self.load_messages(id, cx);
        }
    }

    /// Whether the open session shows a job that is running, whose time keeps counting.
    pub(in crate::ui::screens::shell::page) fn sessions_running(&self) -> bool {
        self.sessions.messages.iter().any(|message| {
            message
                .parts
                .iter()
                .flat_map(|part| &part.jobs)
                .chain(&message.reply)
                .any(|job| job.status == JobStatus::Running)
        })
    }

    /// A session's title job changed to `status`: while it runs the session shows it is
    /// being titled; once it ends the list shows the title, and a failure on the open
    /// session says so.
    pub(in crate::ui::screens::shell::page) fn session_title_changed(
        &mut self,
        id: SessionId,
        job_id: JobId,
        status: JobStatus,
        cx: &mut Context<Self>,
    ) {
        if !status.is_terminal() {
            self.sessions.titling.insert(id);
            return;
        }
        self.sessions.titling.remove(&id);
        if status == JobStatus::Failed && self.sessions.session_id() == Some(id) {
            // Signed out, or a sign-in that expired, is the reply's to say, and signing in
            // names the session after all; any other failure is the title's own.
            self.background(
                move |app| app.job(job_id),
                move |view, job, cx| {
                    let setup = matches!(
                        &job,
                        Ok(Some(job))
                            if matches!(job.error_kind, Some(ErrorKind::Config | ErrorKind::Auth))
                    );
                    if !setup && view.sessions.session_id() == Some(id) {
                        view.sessions.error = Some(Message::TitleGenerationError);
                        cx.notify();
                    }
                },
                cx,
            );
        }
        // Only a title changed, and the sessions list is what shows it.
        self.load_session_list(cx);
    }

    /// Opens the draft of a new session in `project_id`, from anywhere in the app.
    pub(in crate::ui::screens::shell::page) fn start_session_in(
        &mut self,
        project_id: ProjectId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.navigate(Page::Projects, cx);
        self.show_project_session();
        self.start_draft(Some(project_id), window, cx);
    }

    pub(in crate::ui::screens::shell::page) fn load_session_list(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        if !self.sessions.list_loading.start() {
            return;
        }
        let exam_mark = self.projects.exam_mark();
        self.background(
            |app| {
                Ok::<_, study_core::Error>((
                    app.projects()?,
                    app.all_sessions()?,
                    app.sessions_being_titled()?,
                ))
            },
            move |view, result, cx| {
                let state = &mut view.sessions;
                state.list_loaded = true;
                match acted(result) {
                    Some((projects, sessions, titling)) => {
                        state.sessions = sessions;
                        state.titling = titling.into_iter().collect();
                        if state.error == Some(Message::SessionsLoadError) {
                            state.error = None;
                        }
                        view.show_projects(projects, &exam_mark);
                        view.settle_view();
                        view.load_recordings(cx);
                    }
                    None => view.sessions.error = Some(Message::SessionsLoadError),
                }
                if view.sessions.list_loading.finish() {
                    view.load_session_list(cx);
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Prepares the preview of every attached file on screen that has none yet, one at a time
    /// so a long conversation never stalls the app.
    pub(in crate::ui::screens::shell::page) fn load_attachment_previews(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        self.sessions.preview_generation += 1;
        let generation = self.sessions.preview_generation;
        let mut wanted = Vec::new();
        for part in self.sessions.shown_parts() {
            if let PartContent {
                source_id: Some(id),
                ..
            } = &part.content
                && !self.sessions.shown.contains_key(id)
                && !wanted.contains(id)
            {
                wanted.push(*id);
            }
        }
        if wanted.is_empty() {
            return;
        }
        self.background_each(
            wanted,
            |app, id| (id, prepare_attachment(app, id)),
            move |view, (id, info), cx| {
                // A newer round covers what is left; `false` stops this one.
                if view.sessions.preview_generation != generation {
                    return false;
                }
                // A preview already shown stays: the window may still be loading its picture,
                // whose file goes with it.
                if let Ok(Some(info)) = info
                    && !view.sessions.shown.contains_key(&id)
                {
                    view.sessions.shown.insert(id, info);
                    cx.notify();
                }
                true
            },
            cx,
        );
    }

    /// Keeps the view pointing at things that still exist after a reload. What was being
    /// written in a session that is gone goes with it, rather than becoming a new session's
    /// draft; the composer itself is emptied once a window is at hand (`composer_stale`).
    fn settle_view(&mut self) {
        let state = &mut self.sessions;
        let sessions = &state.sessions;
        state
            .unsent
            .retain(|id, _| id.is_none_or(|id| sessions.iter().any(|s| s.id == id)));
        let first_project = state.projects.first().map(|project| project.id);
        match state.view {
            SessionView::Open(id) | SessionView::ConfirmDelete(id)
                if state.session(id).is_none() =>
            {
                state.view = SessionView::Draft {
                    project_id: first_project,
                };
                state.messages.clear();
                state.messages_for = None;
                state.attachments.clear();
                state.composer_stale = true;
            }
            SessionView::Draft { project_id }
                if project_id.is_none_or(|id| !state.projects.iter().any(|p| p.id == id)) =>
            {
                state.view = SessionView::Draft {
                    project_id: first_project,
                };
            }
            _ => {}
        }
    }

    /// Loads the timeline of `session_id`. Reloading the session already shown keeps its
    /// messages on screen meanwhile; another session starts empty, loading.
    pub(in crate::ui::screens::shell::page) fn load_messages(
        &mut self,
        session_id: SessionId,
        cx: &mut Context<Self>,
    ) {
        self.sessions.message_generation += 1;
        let generation = self.sessions.message_generation;
        if self.sessions.messages_for != Some(session_id) {
            self.sessions.messages.clear();
            self.sessions.messages_for = None;
            self.sessions.messages_loading = true;
        }
        self.background(
            move |app| app.messages(session_id),
            move |view, result, cx| {
                let state = &mut view.sessions;
                if state.message_generation != generation {
                    return;
                }
                state.messages_loading = false;
                match acted(result) {
                    Some(messages) => {
                        let first_load = state.messages_for != Some(session_id);
                        if first_load || messages.len() != state.messages.len() {
                            state.scroll_to_end = true;
                        }
                        state.versions.observe(&messages, cx);
                        state.messages = messages;
                        state.messages_for = Some(session_id);
                        if state.error == Some(Message::MessagesLoadError) {
                            state.error = None;
                        }
                        view.load_attachment_previews(cx);
                        view.keep_time(cx);
                    }
                    None => state.error = Some(Message::MessagesLoadError),
                }
                cx.notify();
            },
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn open_session(
        &mut self,
        id: SessionId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.sessions.view == SessionView::Open(id) {
            return;
        }
        self.swap_unsent(Some(id), false, window, cx);
        self.show_session(id, cx);
        self.focus_composer(window, cx);
    }

    /// Opens session `id` from work that has no window at hand, such as a recorder that just
    /// started: what the composer holds is kept for the view it was written in, and the
    /// composer takes what `id` has unsent at the next render (`composer_stale`).
    pub(in crate::ui::screens::shell::page) fn switch_session(
        &mut self,
        id: SessionId,
        cx: &mut Context<Self>,
    ) {
        if self.sessions.view == SessionView::Open(id) {
            return;
        }
        // A composer already stale holds nothing worth keeping.
        if !self.sessions.composer_stale {
            self.keep_unsent(cx);
            self.sessions.composer_stale = true;
        }
        self.show_session(id, cx);
    }

    /// Puts session `id` on screen, starting it as it was left: no panel, no error, every
    /// job folded. The composer is the caller's to swap.
    fn show_session(&mut self, id: SessionId, cx: &mut Context<Self>) {
        self.sessions.view = SessionView::Open(id);
        self.sessions.close_panel();
        self.sessions.error = None;
        self.sessions.expanded.clear();
        self.load_messages(id, cx);
        cx.notify();
    }

    pub(in crate::ui::screens::shell::page) fn start_draft(
        &mut self,
        project_id: Option<ProjectId>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let project_id = project_id.or_else(|| self.current_project_id());
        self.swap_unsent(None, false, window, cx);
        self.sessions.view = SessionView::Draft { project_id };
        self.sessions.close_panel();
        self.sessions.messages.clear();
        self.sessions.messages_for = None;
        self.sessions.error = None;
        self.focus_composer(window, cx);
        cx.notify();
    }

    /// The project of whatever is on screen, else the first one.
    fn current_project_id(&self) -> Option<ProjectId> {
        let state = &self.sessions;
        match state.view {
            SessionView::Draft { project_id } => project_id,
            SessionView::Open(id) | SessionView::ConfirmDelete(id) => {
                state.session(id).map(|session| session.project_id)
            }
        }
        .or_else(|| state.projects.first().map(|project| project.id))
    }

    /// Keeps what the composer holds for the session on screen (unless `discard`), and puts
    /// back what was left unsent in `to` (a session, or `None` for a new one).
    fn swap_unsent(
        &mut self,
        to: Option<SessionId>,
        discard: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // What a vanished session left in the composer is not this view's to keep.
        let discard = std::mem::take(&mut self.sessions.composer_stale) || discard;
        let from = self.sessions.session_id();
        if from == to && !discard {
            return;
        }
        if discard {
            self.sessions.attachments.clear();
        } else {
            self.keep_unsent(cx);
        }
        let state = &mut self.sessions;
        let back = state.unsent.remove(&to).unwrap_or_default();
        state.attachments = back.attachments;
        let composer = state.composer.clone();
        composer.update(cx, |input, cx| input.set_value(back.text, window, cx));
        chip_mentions(&composer, window, cx);
        self.sessions.picker.refresh(&composer, cx);
    }

    /// Keeps what the composer holds as unsent in the view on screen, taking its files; the
    /// text stays in the composer until it is swapped.
    fn keep_unsent(&mut self, cx: &mut Context<Self>) {
        let from = self.sessions.session_id();
        let state = &mut self.sessions;
        let kept = Unsent {
            text: state.composer.read(cx).value().to_string(),
            attachments: std::mem::take(&mut state.attachments),
        };
        state.unsent.remove(&from);
        if !kept.text.trim().is_empty() || !kept.attachments.is_empty() {
            state.unsent.insert(from, kept);
        }
    }

    fn focus_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sessions
            .composer
            .update(cx, |input, cx| input.focus(window, cx));
    }

    fn sync_composer(&mut self, locale: Locale, window: &mut Window, cx: &mut Context<Self>) {
        if self.sessions.composer_locale != Some(locale) {
            self.sessions.composer_locale = Some(locale);
            self.sessions.composer.update(cx, |input, cx| {
                input.set_placeholder(text(locale, Message::ComposerPlaceholder), window, cx)
            });
        }
        self.discard_stale_composer(window, cx);
    }

    /// Empties what a vanished session left in the composer (see `settle_view`), putting
    /// back what the view on screen has unsent.
    fn discard_stale_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.sessions.composer_stale {
            self.swap_unsent(self.sessions.session_id(), false, window, cx);
        }
    }

    pub(super) fn can_send(&self, cx: &Context<Self>) -> bool {
        let state = &self.sessions;
        let has_content =
            !state.attachments.is_empty() || !state.composer.read(cx).value().trim().is_empty();
        has_content && state.has_target() && state.can_edit() && self.workers.ready()
    }

    pub(super) fn send_message(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.workers.allow(&mut self.sessions.error, cx) || !self.can_send(cx) {
            return;
        }
        let locale = self.preferences.language;
        let body = self.sessions.composer.read(cx).value();
        let files = self.sessions.attachments.clone();
        let Some(target) = self.sessions.target(|| {
            derive_title(&body, &files)
                .unwrap_or_else(|| text(locale, Message::NewSession).to_owned())
        }) else {
            return;
        };
        self.sessions.sending = true;
        self.sessions.error = None;
        let started_from = self.sessions.view;
        cx.notify();
        self.background_in_window(
            window,
            move |app| {
                target.write(app, |session_id| {
                    app.post_message(session_id, &body, &files)?;
                    Ok(session_id)
                })
            },
            move |view, result, window, cx| {
                view.sessions.sending = false;
                match result {
                    Ok(session_id) => {
                        // Every draft shares one composer, so one opened in another project
                        // meanwhile still holds what was sent.
                        if view.sessions.session_id() == started_from.session()
                            && !view.sessions.composer_stale
                        {
                            view.sessions.attachments.clear();
                            view.sessions
                                .composer
                                .update(cx, |input, cx| input.set_value(String::new(), window, cx));
                        } else {
                            // What was kept of the composer for later goes.
                            view.sessions.unsent.remove(&started_from.session());
                        }
                        // Still where it was sent from: the session shows. Elsewhere, the
                        // page stays there.
                        if view.sessions.view == started_from {
                            view.sessions.view = SessionView::Open(session_id);
                            view.sessions.scroll_to_end = true;
                            view.load_messages(session_id, cx);
                        }
                        view.load_session_list(cx);
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        // A failure says nothing on another page the user went to meanwhile.
                        if view.sessions.view == started_from {
                            view.sessions.error = Some(Message::SendMessageError);
                        }
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Asks the title agent for a new title from the whole conversation. The title job's
    /// events say when it ends.
    pub(super) fn regenerate_title(&mut self, session_id: SessionId, cx: &mut Context<Self>) {
        if !self.workers.ready() || !self.sessions.titling.insert(session_id) {
            return;
        }
        self.sessions.error = None;
        cx.notify();
        self.background(
            move |app| app.regenerate_title(session_id),
            move |view, result, cx| {
                if let Err(error) = result {
                    crate::features::errors::report(&error);
                    view.sessions.titling.remove(&session_id);
                    view.sessions
                        .fail_in(session_id, Message::TitleGenerationError);
                }
                cx.notify();
            },
            cx,
        );
    }

    pub(super) fn choose_attachments(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.sessions.can_edit() {
            return;
        }
        self.sessions.picking = true;
        cx.notify();
        self.pick_files(
            Message::AttachFiles,
            window,
            |view, picked, window, cx| {
                view.sessions.picking = false;
                match picked {
                    Picked::Files(paths) => view.add_attachments(paths, window, cx),
                    Picked::Dismissed => {}
                    Picked::Failed => view.sessions.error = Some(Message::MediaPickerError),
                }
                cx.notify();
            },
            cx,
        );
    }

    pub(super) fn add_attachments(
        &mut self,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if matches!(self.sessions.view, SessionView::ConfirmDelete(_)) || self.sessions.sending {
            return;
        }
        for path in paths {
            if path.is_file() && !self.sessions.attachments.contains(&path) {
                self.sessions.attachments.push(path);
            }
        }
        self.focus_composer(window, cx);
        cx.notify();
    }

    /// Starts a failed or stopped job again.
    pub(super) fn retry_job(&mut self, job_id: JobId, cx: &mut Context<Self>) {
        self.change_session_job(move |app| app.retry_job(job_id), cx);
    }

    /// Stops a queued or running job.
    pub(super) fn stop_job(&mut self, job_id: JobId, cx: &mut Context<Self>) {
        self.change_session_job(move |app| app.cancel_job(job_id), cx);
    }

    /// Runs `change` on a job of the open session, then reloads the session so its new state
    /// shows even before the job's event arrives. `Ok(false)` means the job had already moved
    /// on (ended, or started again elsewhere), which is not a failure.
    fn change_session_job(
        &mut self,
        change: impl FnOnce(&study_app::App) -> study_core::Result<bool> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        let Some(session_id) = self.sessions.session_id() else {
            return;
        };
        if !self.workers.allow(&mut self.sessions.error, cx) {
            return;
        }
        self.background(
            change,
            move |view, changed, cx| {
                if let Err(error) = &changed {
                    crate::features::errors::report(error);
                    view.sessions.fail_in(session_id, Message::JobActionError);
                }
                view.reload_session(session_id, cx);
            },
            cx,
        );
    }

    pub(super) fn delete_session(
        &mut self,
        id: SessionId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.sessions.can_delete(id) {
            return;
        }
        let project_id = self.sessions.session(id).map(|session| session.project_id);
        self.sessions.busy = true;
        self.sessions.error = None;
        cx.notify();
        self.background_in_window(
            window,
            move |app| app.delete_session(id),
            move |view, result, window, cx| {
                view.sessions.busy = false;
                match acted(result) {
                    Some(true) => {
                        let open = view.sessions.session_id() == Some(id);
                        view.sessions.sessions.retain(|session| session.id != id);
                        view.settle_view();
                        if open {
                            view.discard_stale_composer(window, cx);
                            // A new session in the same project, when that is still there.
                            if project_id
                                .is_some_and(|p| view.sessions.projects.iter().any(|q| q.id == p))
                            {
                                view.sessions.view = SessionView::Draft { project_id };
                            }
                        }
                    }
                    Some(false) | None => view.sessions.error = Some(Message::SessionsSaveError),
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Handles `keystroke` for the composer that has the keyboard, before its text box does:
    /// pasting files or an image attaches them, and the mention picker takes its keys while
    /// it offers mentions. Whether the keystroke was used.
    fn composer_key(
        &mut self,
        keystroke: &gpui_kit::Keystroke,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let has_keyboard = |input: &Entity<TextareaState>, window: &Window, cx: &gpui_kit::App| {
            gpui_kit::Focusable::focus_handle(input.read(cx), cx).is_focused(window)
        };
        let thread = if has_keyboard(&self.sessions.composer, window, cx) {
            false
        } else if has_keyboard(&self.sessions.thread.composer, window, cx) {
            true
        } else {
            return false;
        };
        let modifiers = keystroke.modifiers;
        if modifiers.secondary() && !modifiers.alt && keystroke.key == PASTE_KEY {
            return self.paste_files(thread, window, cx);
        }
        if study_ui::is_shortcut(modifiers) {
            return false;
        }
        let (input, picker) = if thread {
            (
                self.sessions.thread.composer.clone(),
                &mut self.sessions.thread.picker,
            )
        } else {
            (self.sessions.composer.clone(), &mut self.sessions.picker)
        };
        let used = picker.key(&keystroke.key, modifiers.shift, &input, window, cx);
        if used {
            cx.notify();
            return true;
        }
        // Escape leaves the text box, so the keyboard reaches the page's shortcuts again;
        // a draft stays as it is.
        if keystroke.key == ESCAPE_KEY && !modifiers.modified() {
            window.focus(&self.focus, cx);
            cx.notify();
            return true;
        }
        // Tab moves through the page in reading order instead of indenting the note, so the
        // notebook above stays reachable from where the learner writes.
        if keystroke.key == TAB_KEY {
            if modifiers.shift {
                window.focus_prev(cx);
            } else {
                window.focus_next(cx);
            }
            cx.notify();
            return true;
        }
        false
    }

    /// Attaches what the clipboard holds to the page's composer, or the thread's: files
    /// copied elsewhere, and images, saved as files first. Whether it held any; when it holds
    /// only text, the text box pastes it as usual.
    fn paste_files(&mut self, thread: bool, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(item) = cx.read_from_clipboard() else {
            return false;
        };
        let mut paths = Vec::new();
        for entry in item.entries() {
            match entry {
                ClipboardEntry::ExternalPaths(files) => paths.extend_from_slice(files.paths()),
                ClipboardEntry::Image(image) => match self.save_pasted_image(image) {
                    Ok(path) => paths.push(path),
                    Err(error) => {
                        crate::features::errors::report(&error);
                        self.sessions.error = Some(Message::PasteImageError);
                        cx.notify();
                        return true;
                    }
                },
                ClipboardEntry::String(_) => {}
            }
        }
        if paths.is_empty() {
            return false;
        }
        if thread {
            self.add_thread_attachments(paths, window, cx);
        } else {
            self.add_attachments(paths, window, cx);
        }
        true
    }

    /// Saves a pasted image as a file named for when it was pasted, to attach it.
    fn save_pasted_image(&mut self, image: &gpui_kit::Image) -> study_core::Result<PathBuf> {
        let name = crate::features::clock::pasted_image_name(
            self.preferences.language,
            image.format.extension(),
        );
        self.sessions.pasted.save(image.id, &name, &image.bytes)
    }

    /// Asks for a finished answer again, as a new version; its job's events show it being
    /// written.
    pub(super) fn reanswer(&mut self, id: MessageId, cx: &mut Context<Self>) {
        self.ask_version(id, move |app| app.reanswer(id), cx);
    }

    /// Deletes a confirmed note or answer; the database deletes what hangs off it (answers,
    /// threads, material and their jobs), and what is on screen is read again.
    pub(super) fn delete_message(&mut self, id: MessageId, cx: &mut Context<Self>) {
        self.sessions.deleting = None;
        let Some(session_id) = self.sessions.messages_for else {
            return;
        };
        if !self.sessions.can_edit() {
            return;
        }
        self.sessions.busy = true;
        self.sessions.error = None;
        cx.notify();
        self.background(
            move |app| app.delete_message(id),
            move |view, result, cx| {
                view.sessions.busy = false;
                if let Err(error) = &result {
                    crate::features::errors::report(error);
                    view.sessions
                        .fail_in(session_id, Message::SessionsSaveError);
                }
                view.reload_session(session_id, cx);
                cx.notify();
            },
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn sessions_page(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> PageView {
        self.sync_composer(locale, window, cx);
        // Set when new messages land, and done once, as the page draws them.
        if std::mem::take(&mut self.sessions.scroll_to_end) {
            self.sessions.scroll.scroll_to_bottom();
        }
        let state = &self.sessions;
        if !state.list_loaded {
            return self.sessions_notice(locale, Message::LoadingSessions, false, None);
        }
        if state.error == Some(Message::SessionsLoadError) && state.projects.is_empty() {
            let retry = button(ids::RETRY_LOAD, text(locale, Message::Retry), cx)
                .on_click(cx.listener(|this, _, _, cx| this.load_session_list(cx)));
            return self.sessions_notice(locale, Message::SessionsLoadError, true, Some(retry));
        }
        if state.projects.is_empty() {
            let projects = button(ids::GO_TO_PROJECTS, text(locale, Message::GoToProjects), cx)
                .primary()
                .icon(IconName::LibraryBig)
                .on_click(cx.listener(|this, _, window, cx| {
                    this.navigate(Page::Projects, cx);
                    this.start_project_create(window, cx);
                }));
            return self.sessions_notice(
                locale,
                Message::NoProjectsForSessions,
                false,
                Some(projects),
            );
        }

        let view = state.view;
        let (body, aside) = match view {
            SessionView::Draft { project_id } => (self.draft_body(project_id, locale, cx), None),
            SessionView::Open(id) | SessionView::ConfirmDelete(id) => {
                self.conversation_body(id, locale, window, cx)
            }
        };
        let header = self.session_header(locale, cx);
        let body = div()
            .id(ids::DROP_TARGET)
            .test_support()
            .aria_label(text(locale, Message::DropFilesToAttach))
            .size_full()
            .min_h_0()
            .child(PageFrame::new(body))
            .drag_over::<ExternalPaths>(move |style, _, _, cx| {
                style.bg(cx.theme().colors.secondary.opacity(0.35))
            })
            .on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| {
                this.add_attachments(paths.paths().to_vec(), window, cx);
            }));
        let view = PageView::with_header(header, body);
        match aside {
            Some((header, width)) => view.aside(header, width),
            None => view,
        }
    }

    /// The session's title, and for an open session, renaming and deleting it.
    fn session_header(&self, locale: Locale, cx: &mut Context<Self>) -> PageHeader {
        let state = &self.sessions;
        let title = match state.view {
            SessionView::Draft { .. } => text(locale, Message::NewSession).to_owned(),
            SessionView::Open(id) | SessionView::ConfirmDelete(id) => state
                .session(id)
                .map(|session| session.title.clone())
                .unwrap_or_default(),
        };
        // Beside the title, the project the session belongs to.
        let project = state
            .view
            .session()
            .and_then(|id| state.session(id))
            .and_then(|session| {
                state
                    .projects
                    .iter()
                    .find(|project| project.id == session.project_id)
            })
            .map(|project| project.name.clone());
        let mut header = PageHeader::new(title).icon(IconName::NotebookText);
        if let Some(project) = project {
            header = header.context(project);
        }
        let SessionView::Open(id) = state.view else {
            return header;
        };
        let titling = state.titling.contains(&id);
        let label = if titling {
            Message::RegeneratingTitle
        } else {
            Message::RegenerateTitle
        };
        // Turns for as long as a title job for this session has not ended.
        let regenerate = icon_button(
            ids::REGENERATE_TITLE,
            text(locale, label),
            IconName::WandSparkles,
            cx,
        )
        .loading(titling)
        .loading_icon(study_ui::icon(IconName::LoaderCircle))
        .disabled(!state.can_edit() || !self.workers.ready())
        .on_click(cx.listener(move |this, _, _, cx| this.regenerate_title(id, cx)));
        let delete = icon_button(
            ids::DELETE,
            text(locale, Message::DeleteSession),
            IconName::Trash,
            cx,
        )
        .disabled(!state.can_delete(id))
        .on_click(cx.listener(move |this, _, _, cx| {
            this.sessions.view = SessionView::ConfirmDelete(id);
            this.sessions.error = None;
            cx.notify();
        }));
        header.action(regenerate).action(delete)
    }

    pub(super) fn toggle_job(&mut self, job_id: JobId, cx: &mut Context<Self>) {
        if !self.sessions.expanded.remove(&job_id) {
            self.sessions.expanded.insert(job_id);
        }
        cx.notify();
    }

    /// Reloads what is on screen of `session_id`: its timeline, and the open thread. Nothing,
    /// when another session has been opened since the work asking for it began.
    pub(in crate::ui::screens::shell::page) fn reload_session(
        &mut self,
        session_id: SessionId,
        cx: &mut Context<Self>,
    ) {
        if self.sessions.session_id() != Some(session_id) {
            return;
        }
        self.load_messages(session_id, cx);
        if let Some(root) = self.sessions.open_thread() {
            self.load_thread(root, cx);
        }
    }

    /// Opens the side panel on an attached file.
    pub(in crate::ui::screens::shell::page) fn show_attachment(
        &mut self,
        source_id: SourceId,
        cx: &mut Context<Self>,
    ) {
        self.sessions.panel = Some(SidePanel::File(source_id));
        self.sessions.cited = None;
        cx.notify();
    }

    /// Opens a cited source (called `name`) at the place cited: beside the conversation when
    /// it is attached here, otherwise over the page.
    pub(in crate::ui::screens::shell::page) fn open_cited(
        &mut self,
        source_id: SourceId,
        name: String,
        at: Anchor,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let attached_here = self
            .sessions
            .shown_parts()
            .any(|part| part.content.source_id == Some(source_id));
        if attached_here {
            self.show_attachment(source_id, cx);
            self.sessions.cited = Some((source_id, at));
            self.sessions.cited_earlier = false;
        } else {
            self.peek_source(source_id, name, at, window, cx);
        }
    }

    pub(in crate::ui::screens::shell::page) fn close_panel(&mut self, cx: &mut Context<Self>) {
        self.sessions.close_panel();
        cx.notify();
    }

    pub(super) fn copy_text(&mut self, value: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(value));
    }
}
