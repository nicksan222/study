//! Sources made in the Library rather than imported: a typed note, or what a web address
//! holds (a page, or a video's sound track). Each opens a small dialog, stores the source
//! under the project the Library is filtered to, and queues its reading.

use super::super::ids;
use crate::ui::screens::shell::page::pages::components::{named_field, show_dialog};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::input::{Input, InputState, TextareaState};
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, WindowExt as _, button::Button,
    button::ButtonVariants as _, dialog::Dialog, input::Textarea,
};
use gpui_kit::{AppContext as _, Entity, Window};
use study_ui::{button, units};

/// The fields of the two dialogs. A dialog closed without saving opens again as it was
/// left; saving clears it.
pub(in crate::ui::screens::shell::page) struct MadeState {
    note_title: Entity<InputState>,
    note_body: Entity<TextareaState>,
    link: Entity<InputState>,
    busy: bool,
    error: Option<Message>,
    placeholders: Option<Locale>,
}

impl MadeState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        Self {
            note_title: cx.new(|cx| InputState::new(window, cx)),
            note_body: cx.new(|cx| TextareaState::new(window, cx)),
            link: cx.new(|cx| InputState::new(window, cx)),
            busy: false,
            error: None,
            placeholders: None,
        }
    }
}

/// Which dialog made a source.
#[derive(Clone, Copy)]
enum Made {
    Note,
    Link,
}

impl AppShell {
    fn sync_made_placeholders(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let locale = self.preferences.language;
        if self.made.placeholders == Some(locale) {
            return;
        }
        self.made.placeholders = Some(locale);
        self.made.note_title.update(cx, |input, cx| {
            input.set_placeholder(text(locale, Message::NoteTitle), window, cx)
        });
        self.made.link.update(cx, |input, cx| {
            input.set_placeholder(text(locale, Message::LinkPlaceholder), window, cx)
        });
        self.made.note_body.update(cx, |input, cx| {
            input.set_placeholder(text(locale, Message::NoteBodyPlaceholder), window, cx)
        });
    }

    pub(in crate::ui::screens::shell::page) fn start_note(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_made_dialog(Self::note_dialog, window, cx);
    }

    pub(in crate::ui::screens::shell::page) fn start_link(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_made_dialog(Self::link_dialog, window, cx);
    }

    /// Opens a dialog that `build` draws afresh each frame from the view's state.
    fn open_made_dialog(
        &mut self,
        build: fn(&Self, Dialog, &Window, &mut Context<Self>) -> Dialog,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.sync_made_placeholders(window, cx);
        self.made.error = None;
        show_dialog(build, window, cx);
    }

    fn note_dialog(&self, dialog: Dialog, window: &Window, cx: &mut Context<Self>) -> Dialog {
        let locale = self.preferences.language;
        let unit = units(cx);
        let content = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(10.))
            .child(
                Input::new(&self.made.note_title)
                    .id(ids::NOTE_TITLE)
                    .aria_label(text(locale, Message::NoteTitle)),
            )
            .child(named_field(
                ids::NOTE_BODY,
                text(locale, Message::NewNote),
                Textarea::new(&self.made.note_body)
                    .h(unit(220.))
                    .aria_label(text(locale, Message::NewNote)),
            ))
            .children(self.made.error.map(|error| {
                div()
                    .text_color(cx.theme().colors.danger)
                    .child(text(locale, error))
            }));
        let save = button(ids::SAVE_NOTE, text(locale, Message::SaveNote), cx)
            .disabled(self.made.busy)
            .on_click(cx.listener(|this, _, window, cx| this.save_note(window, cx)));
        self.made_dialog(dialog, window, Message::NewNote, content, save, cx)
    }

    fn link_dialog(&self, dialog: Dialog, window: &Window, cx: &mut Context<Self>) -> Dialog {
        let locale = self.preferences.language;
        let unit = units(cx);
        let busy = self.made.busy;
        let content = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(10.))
            .child(
                Input::new(&self.made.link)
                    .id(ids::LINK_ADDRESS)
                    .aria_label(text(locale, Message::AddLink)),
            )
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(cx.theme().colors.muted_foreground)
                    .whitespace_normal()
                    .child(text(
                        locale,
                        if busy {
                            Message::AddingLink
                        } else {
                            Message::AddLinkHint
                        },
                    )),
            )
            .children(self.made.error.map(|error| {
                div()
                    .text_color(cx.theme().colors.danger)
                    .whitespace_normal()
                    .child(text(locale, error))
            }));
        // Fetching needs background work, which may still be starting.
        let save = button(ids::SAVE_LINK, text(locale, Message::AddLink), cx)
            .disabled(busy || self.workers.starting())
            .on_click(cx.listener(|this, _, window, cx| this.add_link(window, cx)));
        self.made_dialog(dialog, window, Message::AddLink, content, save, cx)
    }

    /// The frame both dialogs share: `content`, then Cancel and `save`. Each dialog disables
    /// its own `save` while a source is being made, and neither closes meanwhile.
    fn made_dialog(
        &self,
        dialog: Dialog,
        window: &Window,
        title: Message,
        content: gpui_kit::Div,
        save: Button,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let locale = self.preferences.language;
        let unit = units(cx);
        let busy = self.made.busy;
        let cancel = button(ids::CANCEL_MADE, text(locale, Message::Cancel), cx)
            .ghost()
            .disabled(busy)
            .on_click(|_, window, cx| window.close_dialog(cx));
        dialog
            .title(text(locale, title))
            .w(unit(520.).min(window.viewport_size().width - unit(48.)))
            .close_button(!busy)
            .keyboard(!busy)
            .overlay_closable(!busy)
            .child(content)
            .footer(
                div()
                    .flex()
                    .justify_end()
                    .gap(unit(8.))
                    .child(cancel)
                    .child(save.primary()),
            )
    }

    fn save_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let title = self.made.note_title.read(cx).value().trim().to_owned();
        let body = self.made.note_body.read(cx).value().trim().to_owned();
        if title.is_empty() || body.is_empty() {
            self.made.error = Some(Message::NoteIncomplete);
            cx.notify();
            return;
        }
        let project = self.media.filter_project;
        let app = self.app.clone();
        self.finish_made(
            async move { app.create_note(project, &title, &body) },
            Made::Note,
            window,
            cx,
        );
    }

    fn add_link(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.workers.allow(&mut self.made.error, cx) {
            return;
        }
        let url = self.made.link.read(cx).value().trim().to_owned();
        if url.is_empty() {
            self.made.error = Some(Message::LinkMissing);
            cx.notify();
            return;
        }
        let project = self.media.filter_project;
        let app = self.app.clone();
        // The link is saved at once; a background job fetches what it points at.
        self.finish_made(
            async move { app.add_link(project, &url) },
            Made::Link,
            window,
            cx,
        );
    }

    /// Makes a source with `work` off the UI thread, then clears `made`'s dialog and shows
    /// it in the Library, or says what went wrong. While another is being made, `work` never
    /// runs.
    fn finish_made(
        &mut self,
        work: impl Future<Output = study_core::Result<study_app::views::Source>> + Send + 'static,
        made: Made,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.made.busy {
            return;
        }
        self.made.busy = true;
        self.made.error = None;
        cx.notify();
        let work = cx.background_executor().spawn(work);
        let handle = window.window_handle();
        cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = handle.update(cx, |_, window, cx| {
                let _ = this.update(cx, |view, cx| {
                    view.made.busy = false;
                    match result {
                        Ok(_) => {
                            // Only the dialog that saved starts empty; the other keeps
                            // what it was left with.
                            let input = match made {
                                Made::Note => {
                                    view.made.note_body.update(cx, |input, cx| {
                                        input.set_value(String::new(), window, cx)
                                    });
                                    &view.made.note_title
                                }
                                Made::Link => &view.made.link,
                            };
                            input
                                .update(cx, |input, cx| input.set_value(String::new(), window, cx));
                            window.close_dialog(cx);
                            view.load_media(cx);
                        }
                        Err(error) => {
                            crate::features::errors::report(&error);
                            view.made.error = Some(Message::MadeSourceError);
                        }
                    }
                    cx.notify();
                });
            });
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::testing::TempApp;
    use crate::ui::screens::shell::page::testing::{
        click, open_shell, wait_until, without_workers,
    };
    use gpui_kit::TestAppContext;

    /// A link waits for background work to start, and says so when it could not.
    #[gpui_kit::test]
    fn a_link_needs_background_work(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let (window, shell) = open_shell(cx, app.app(), Preferences::default());
        click(cx, window, Page::MediaList as usize);
        click(cx, window, ids::ADD_LINK);
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| {
                shell.made.link.update(cx, |input, cx| {
                    input.set_value("https://example.com", window, cx)
                })
            })
        })
        .unwrap();
        let error = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).made.error);

        // Still starting: the button waits.
        click(cx, window, ids::SAVE_LINK);
        assert_eq!(error(cx), None);

        without_workers(cx, &shell);
        click(cx, window, ids::SAVE_LINK);
        assert_eq!(error(cx), Some(Message::WorkspaceUnavailable));
        assert!(app.sources().unwrap().is_empty());
    }

    /// Saving a note leaves the link dialog as it was left, and empties only the note's.
    #[gpui_kit::test]
    fn saving_one_dialog_leaves_the_other_as_it_was(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let (window, shell) = open_shell(cx, app.app(), Preferences::default());
        click(cx, window, Page::MediaList as usize);
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| {
                let made = &shell.made;
                for (input, value) in [
                    (&made.link, "https://example.com"),
                    (&made.note_title, "Cells"),
                ] {
                    input.update(cx, |input, cx| input.set_value(value, window, cx));
                }
                made.note_body
                    .update(cx, |input, cx| input.set_value("Membranes", window, cx));
                shell.save_note(window, cx);
            })
        })
        .unwrap();
        wait_until(cx, |cx| cx.update(|cx| !shell.read(cx).made.busy));

        assert_eq!(app.sources().unwrap().len(), 1);
        let fields = cx.update(|cx| {
            let made = &shell.read(cx).made;
            (
                made.note_title.read(cx).value().to_string(),
                made.note_body.read(cx).value().to_string(),
                made.link.read(cx).value().to_string(),
            )
        });
        assert_eq!(
            fields,
            (
                String::new(),
                String::new(),
                "https://example.com".to_owned()
            )
        );
    }
}
