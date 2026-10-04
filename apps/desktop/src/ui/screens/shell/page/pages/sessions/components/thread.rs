//! The thread under an attachment, in the side panel: the file and what was read from it
//! first, then every reply (notes, more files, answers), and a composer of its own at the
//! bottom, as in a chat app.

use super::super::ids;
use super::super::page::SidePanel;
use super::{
    Attached, MentionPicker, ask_button, chip_mentions, mention_picker, message_row, pending_files,
    send_button, source_card, with_context,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _,
    input::{InputEvent, TextareaState},
};
use gpui_kit::{
    AnyElement, AppContext as _, Entity, ExternalPaths, ScrollHandle,
    StatefulInteractiveElement as _, Subscription,
};
use std::path::PathBuf;
use study_app::views::{ChatMessage, PartContent, Place, Thread};
use study_core::PartId;
use study_localization::reply_count;
use study_ui::{Composer, icon_button, units};

/// Width of the thread panel, before scaling.
const PANEL_WIDTH: f32 = 440.;

/// The open thread, and the reply being written in it.
pub(in crate::ui::screens::shell::page) struct ThreadState {
    /// The thread `loaded`, `composer` and `attachments` belong to.
    root: Option<PartId>,
    loaded: Option<Thread>,
    /// Only the newest load may apply its result.
    generation: u64,
    pub(in crate::ui::screens::shell::page) composer: Entity<TextareaState>,
    composer_locale: Option<Locale>,
    pub(in crate::ui::screens::shell::page) attachments: Vec<PathBuf>,
    pub(in crate::ui::screens::shell::page) sending: bool,
    picking: bool,
    scroll: ScrollHandle,
    scroll_to_end: bool,
    /// The mentions offered while one is typed in `composer`.
    pub(in crate::ui::screens::shell::page) picker: MentionPicker,
    _composer_subscription: Subscription,
}

impl ThreadState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let composer = cx.new(|cx| TextareaState::new(window, cx).submit_on_enter(true));
        let subscription = cx.subscribe_in(
            &composer,
            window,
            |this, input, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { shift: false, .. } => this.send_reply(window, cx),
                InputEvent::Change => {
                    chip_mentions(input, window, cx);
                    this.sessions.thread.picker.refresh(input, cx);
                    cx.notify()
                }
                _ => {}
            },
        );
        Self {
            root: None,
            loaded: None,
            generation: 0,
            composer,
            composer_locale: None,
            attachments: Vec::new(),
            sending: false,
            picking: false,
            scroll: ScrollHandle::new(),
            scroll_to_end: false,
            picker: MentionPicker::default(),
            _composer_subscription: subscription,
        }
    }

    /// The loaded thread under `root`, once it has loaded.
    pub(in crate::ui::screens::shell::page) fn showing(&self, root: PartId) -> Option<&Thread> {
        self.loaded.as_ref().filter(|thread| thread.root.id == root)
    }

    /// The replies of the loaded thread.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn replies(&self) -> &[ChatMessage] {
        self.loaded.as_ref().map_or(&[], |thread| &thread.replies)
    }

    fn can_edit(&self) -> bool {
        !self.sending && !self.picking
    }
}

impl AppShell {
    /// Opens the thread under an attachment beside the conversation.
    pub(in crate::ui::screens::shell::page) fn open_thread(
        &mut self,
        root: PartId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let thread = &mut self.sessions.thread;
        if thread.root != Some(root) {
            // Another thread: its draft does not follow.
            thread.root = Some(root);
            thread.loaded = None;
            thread.attachments.clear();
            thread
                .composer
                .update(cx, |input, cx| input.set_value(String::new(), window, cx));
        }
        thread.scroll_to_end = true;
        self.sessions.panel = Some(SidePanel::Thread(root));
        self.load_thread(root, cx);
        self.sessions
            .thread
            .composer
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    /// Loads the thread under `root`. Only the newest load applies, and only while `root` is
    /// still the open thread.
    pub(in crate::ui::screens::shell::page) fn load_thread(
        &mut self,
        root: PartId,
        cx: &mut Context<Self>,
    ) {
        self.sessions.thread.generation += 1;
        let generation = self.sessions.thread.generation;
        self.background(
            move |app| app.thread(root),
            move |view, result, cx| {
                let state = &mut view.sessions;
                if state.thread.generation != generation || state.thread.root != Some(root) {
                    return;
                }
                match result {
                    Ok(Some(thread)) => {
                        let before = state.thread.loaded.as_ref().map(|t| t.replies.len());
                        if before != Some(thread.replies.len()) {
                            state.thread.scroll_to_end = true;
                        }
                        state.versions.observe(&thread.replies, cx);
                        state.thread.loaded = Some(thread);
                        if state.error == Some(Message::ThreadLoadError) {
                            state.error = None;
                        }
                        view.load_attachment_previews(cx);
                    }
                    // The attachment's message was deleted, and its thread with it.
                    Ok(None) => {
                        if state.open_thread() == Some(root) {
                            state.panel = None;
                        }
                        state.thread.loaded = None;
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        state.error = Some(Message::ThreadLoadError);
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    fn can_reply(&self, cx: &Context<Self>) -> bool {
        let thread = &self.sessions.thread;
        let has_content =
            !thread.attachments.is_empty() || !thread.composer.read(cx).value().trim().is_empty();
        has_content
            && self.sessions.open_thread().is_some()
            && thread.can_edit()
            && self.workers.ready()
    }

    /// Posts the reply being written to the open thread.
    pub(in crate::ui::screens::shell::page) fn send_reply(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(root) = self.sessions.open_thread() else {
            return;
        };
        if !self.workers.allow(&mut self.sessions.error, cx) || !self.can_reply(cx) {
            return;
        }
        let thread = &mut self.sessions.thread;
        let body = thread.composer.read(cx).value();
        let files = thread.attachments.clone();
        thread.sending = true;
        self.sessions.error = None;
        cx.notify();
        self.background_in_window(
            window,
            move |app| app.post_message(Place::Thread(root), &body, &files),
            move |view, result, window, cx| {
                view.sessions.thread.sending = false;
                match result {
                    Ok(message) => {
                        // The draft empties only if its thread is still open: the composer
                        // may hold another thread's by now.
                        if view.sessions.thread.root == Some(root) {
                            let thread = &mut view.sessions.thread;
                            thread.attachments.clear();
                            thread.scroll_to_end = true;
                            thread
                                .composer
                                .update(cx, |input, cx| input.set_value(String::new(), window, cx));
                        }
                        // The timeline counts the reply.
                        view.reload_session(message.session_id, cx);
                        view.load_session_list(cx);
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        // Said only beside the thread it was sent to.
                        if view.sessions.open_thread() == Some(root) {
                            view.sessions.error = Some(Message::SendMessageError);
                        }
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    fn choose_thread_attachments(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.sessions.thread.can_edit() {
            return;
        }
        self.sessions.thread.picking = true;
        cx.notify();
        self.pick_files(
            Message::AttachFiles,
            window,
            |view, picked, window, cx| {
                view.sessions.thread.picking = false;
                match picked {
                    Picked::Files(paths) => view.add_thread_attachments(paths, window, cx),
                    Picked::Dismissed => {}
                    Picked::Failed => view.sessions.error = Some(Message::MediaPickerError),
                }
                cx.notify();
            },
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn add_thread_attachments(
        &mut self,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let thread = &mut self.sessions.thread;
        if thread.sending {
            return;
        }
        for path in paths {
            if path.is_file() && !thread.attachments.contains(&path) {
                thread.attachments.push(path);
            }
        }
        thread
            .composer
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    /// The panel for the thread under `root`.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn thread_panel(
        &mut self,
        root: PartId,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> super::Panel {
        let unit = units(cx);
        let colors = cx.theme().colors;
        self.sync_thread_composer(locale, window, cx);
        if std::mem::take(&mut self.sessions.thread.scroll_to_end) {
            self.sessions.thread.scroll.scroll_to_bottom();
        }
        let state = &self.sessions;
        let thread = state.thread.showing(root);
        let file_name = thread.map(|thread| thread.root.content.name.clone());

        // The title bar shows the thread's header, above the panel.
        let mut header = study_ui::PageHeader::new(text(locale, Message::ThreadTitle))
            .icon(IconName::Reply)
            .action(
                icon_button(
                    ids::THREAD_CLOSE,
                    text(locale, Message::ClosePanel),
                    IconName::X,
                    cx,
                )
                .on_click(cx.listener(|this, _, _, cx| this.close_panel(cx))),
            );
        if let Some(name) = file_name {
            header = header.context(name);
        }

        let body = self.thread_body(thread, locale, window, cx);

        let footer = div()
            .flex_none()
            .w_full()
            .px(unit(12.))
            .pb(unit(12.))
            .pt(unit(4.))
            .child(self.thread_composer(locale, cx));

        let panel = div()
            .id(ids::THREAD_DROP_TARGET)
            .test_support()
            .aria_label(text(locale, Message::DropFilesToAttach))
            .w(unit(PANEL_WIDTH))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .border_l_1()
            .border_color(colors.border)
            .bg(colors.background)
            .child(
                div()
                    .id(ids::THREAD_SCROLL)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.sessions.thread.scroll)
                    .child(body),
            )
            .child(footer)
            // Files dropped on the thread go to its reply, not to the conversation's.
            .on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| {
                cx.stop_propagation();
                this.add_thread_attachments(paths.paths().to_vec(), window, cx);
            }));
        super::reveal(panel, header, PANEL_WIDTH, cx)
    }

    /// The thread itself: the file and what was read from it, how many replies follow, and
    /// each reply; or that it is still loading.
    fn thread_body(
        &self,
        thread: Option<&Thread>,
        locale: Locale,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let state = &self.sessions;
        let mut body = div()
            .w_full()
            .px(unit(16.))
            .py(unit(16.))
            .flex()
            .flex_col()
            .gap(unit(16.));
        match thread {
            Some(thread) => {
                {
                    let PartContent {
                        source_id,
                        name,
                        kind,
                    } = &thread.root.content;
                    // The file and all that was read from it open the thread.
                    let head = &thread.root;
                    body = body.child(source_card(
                        Attached {
                            part: head.id,
                            source_id: *source_id,
                            name,
                            kind: *kind,
                            info: source_id.and_then(|id| state.shown.get(&id)),
                            job: head.jobs.last(),
                            document: head.document.as_ref(),
                            expanded: true,
                            whole: true,
                            thread: None,
                        },
                        locale,
                        cx,
                    ));
                }
                if !thread.replies.is_empty() {
                    body = body.child(
                        div()
                            .w_full()
                            .flex()
                            .items_center()
                            .gap(unit(10.))
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .text_color(colors.muted_foreground)
                            .child(
                                div()
                                    .flex_none()
                                    .child(reply_count(locale, thread.replies.len())),
                            )
                            .child(div().flex_1().h(unit(1.)).bg(colors.border)),
                    );
                }
                for reply in &thread.replies {
                    body = body.child(message_row(
                        reply,
                        locale,
                        &state.expanded,
                        &state.shown,
                        None,
                        state.row_marks(self.chatgpt_state(), window, cx),
                        cx,
                    ));
                }
            }
            None => {
                body = body.child(
                    div()
                        .text_color(colors.muted_foreground)
                        .child(text(locale, Message::LoadingMessages)),
                );
            }
        }
        body
    }

    fn sync_thread_composer(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let thread = &mut self.sessions.thread;
        if thread.composer_locale != Some(locale) {
            thread.composer_locale = Some(locale);
            thread.composer.update(cx, |input, cx| {
                input.set_placeholder(text(locale, Message::ThreadComposerPlaceholder), window, cx)
            });
        }
    }

    /// The thread's own message box, with its attach, tools and send buttons.
    fn thread_composer(&self, locale: Locale, cx: &mut Context<Self>) -> AnyElement {
        let thread = &self.sessions.thread;
        let composer = Composer::new(&thread.composer)
            .id(ids::THREAD_COMPOSER)
            .action(
                icon_button(
                    ids::THREAD_ATTACH,
                    text(locale, Message::AttachFiles),
                    IconName::Paperclip,
                    cx,
                )
                .disabled(!thread.can_edit())
                .on_click(
                    cx.listener(|this, _, window, cx| this.choose_thread_attachments(window, cx)),
                ),
            )
            .action(ask_button(
                ids::THREAD_ASK,
                &thread.composer,
                thread.can_edit(),
                locale,
                cx,
            ))
            .submit_button(
                send_button(
                    ids::THREAD_SEND,
                    thread.sending,
                    self.can_reply(cx),
                    locale,
                    cx,
                )
                .on_click(cx.listener(|this, _, window, cx| this.send_reply(window, cx))),
            );
        let context = [
            mention_picker(
                &thread.picker,
                ids::THREAD_MENTION_SUGGESTION,
                |this| {
                    (
                        &this.sessions.thread.composer,
                        &mut this.sessions.thread.picker,
                    )
                },
                locale,
                cx,
            ),
            pending_files(
                &thread.attachments,
                ids::THREAD_REMOVE_ATTACHMENT,
                thread.sending,
                |this| &mut this.sessions.thread.attachments,
                locale,
                cx,
            ),
        ];
        with_context(composer, context, cx).into_any_element()
    }
}
