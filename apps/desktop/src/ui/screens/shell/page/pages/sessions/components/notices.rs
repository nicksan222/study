//! What the page shows instead of a conversation or over it: a centered notice, the alerts
//! that ask before a session or a message is deleted, and the error line under the composer.

use super::super::ids;
use super::super::page::SessionView;
use crate::ui::screens::shell::page::pages::components::Alert;
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, button::ButtonVariants as _};
use study_ui::{EmptyState, PageFrame, PageHeader, PageView, button};

impl AppShell {
    /// A centered status for states without a session to show.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn sessions_notice(
        &self,
        locale: Locale,
        message: Message,
        is_error: bool,
        action: Option<gpui_kit::component::button::Button>,
    ) -> PageView {
        let mut body = EmptyState::new(text(locale, message))
            .icon(IconName::NotebookText)
            .failed(is_error);
        if let Some(action) = action {
            body = body.action(action);
        }
        PageView::with_header(
            PageHeader::new(text(locale, Message::Sessions)).icon(IconName::NotebookText),
            PageFrame::new(body),
        )
    }

    /// What the sessions ask before something goes, as an alert over the conversation:
    /// deleting the open session with everything in it, or one message.
    pub(in crate::ui::screens::shell::page) fn sessions_alert(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<Alert> {
        let state = &self.sessions;
        if let SessionView::ConfirmDelete(id) = state.view {
            let confirm = button(
                ids::CONFIRM_DELETE,
                text(locale, Message::DeleteSession),
                cx,
            )
            .danger()
            .disabled(!state.can_delete(id))
            .on_click(cx.listener(move |this, _, window, cx| this.delete_session(id, window, cx)));
            let alert = Alert::new(
                text(locale, Message::AlertDeleteSession),
                text(locale, Message::ConfirmDeleteSession),
                confirm,
                ids::CANCEL_DELETE,
                move |this, cx| {
                    this.sessions.view = SessionView::Open(id);
                    this.sessions.error = None;
                    cx.notify();
                },
            );
            return Some(
                alert
                    .locked(!state.can_edit())
                    .note(self.error_line(locale, cx)),
            );
        }
        let id = state.deleting?;
        let confirm = button(
            (ids::CONFIRM_DELETE_MESSAGE, id.get() as u64),
            text(locale, Message::DeleteMessage),
            cx,
        )
        .danger()
        .on_click(cx.listener(move |this, _, _, cx| this.delete_message(id, cx)));
        // An entry with several versions says they all go.
        let versions = state
            .messages
            .iter()
            .chain(state.thread.replies())
            .find(|message| message.id == id)
            .map_or(0, |message| message.versions.len());
        let consequence = if versions > 1 {
            study_localization::delete_entry_versions(locale, versions)
        } else {
            text(locale, Message::ConfirmDeleteMessage).to_owned()
        };
        Some(Alert::new(
            text(locale, Message::AlertDeleteMessage),
            consequence,
            confirm,
            (ids::CANCEL_DELETE_MESSAGE, id.get() as u64),
            |this, cx| {
                this.sessions.deleting = None;
                cx.notify();
            },
        ))
    }

    /// What went wrong last on the page, or that background work could not start.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn error_line(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let error = self.sessions.error.or(self
            .workers
            .failed()
            .then_some(Message::WorkspaceUnavailable))?;
        Some(
            div()
                .text_size(study_ui::scaled_px(cx, 13.))
                .text_color(cx.theme().colors.danger)
                .child(text(locale, error))
                .into_any_element(),
        )
    }
}
