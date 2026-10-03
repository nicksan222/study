//! The composer: the message box with its attach, tools, record and send buttons, and above
//! its text the mentions offered, the recording and the files waiting to be sent. The
//! thread's composer is built from the same pieces.

use super::super::ids;
use super::{ask_button, mention_picker};
use crate::features::media::KindStyle as _;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _,
    button::{Button, ButtonVariants as _},
};
use gpui_kit::{AnyElement, App, ObjectFit, SharedString, StyledImage as _, img, relative};
use std::path::{Path, PathBuf};
use study_ui::{Composer, icon_button, units};

impl AppShell {
    /// The page's composer, with `trailing` beside its buttons.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn composer(
        &self,
        locale: Locale,
        trailing: Option<AnyElement>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let state = &self.sessions;
        let mut composer = Composer::new(&state.composer)
            .id(ids::COMPOSER)
            .action(
                icon_button(
                    ids::ATTACH,
                    text(locale, Message::AttachFiles),
                    IconName::Paperclip,
                    cx,
                )
                .disabled(!state.can_edit())
                .on_click(cx.listener(|this, _, window, cx| this.choose_attachments(window, cx))),
            )
            .action(ask_button(
                ids::ASK,
                &state.composer,
                state.can_edit(),
                locale,
                cx,
            ))
            .action(self.record_button(locale, cx))
            .submit_button(
                send_button(ids::SEND, state.sending, self.can_send(cx), locale, cx)
                    .on_click(cx.listener(|this, _, window, cx| this.send_message(window, cx))),
            );
        if let Some(trailing) = trailing {
            composer = composer.trailing(trailing);
        }
        let context = [
            mention_picker(
                &state.picker,
                ids::MENTION_SUGGESTION,
                |this| (&this.sessions.composer, &mut this.sessions.picker),
                locale,
                cx,
            ),
            self.recording_shelf(locale, cx),
            pending_files(
                &state.attachments,
                ids::REMOVE_ATTACHMENT,
                state.sending,
                |this| &mut this.sessions.attachments,
                locale,
                cx,
            ),
        ];
        with_context(composer, context, cx).into_any_element()
    }
}

/// A composer's send button, saying so while `sending`.
pub(in crate::ui::screens::shell::page::pages::sessions) fn send_button(
    id: usize,
    sending: bool,
    enabled: bool,
    locale: Locale,
    cx: &App,
) -> Button {
    let label = if sending {
        Message::SendingMessage
    } else {
        Message::SendMessage
    };
    icon_button(id, text(locale, label), IconName::ArrowUp, cx)
        .primary()
        .loading(sending)
        .disabled(!enabled)
}

/// `composer` with what sits above its text, stacked, when there is any.
pub(in crate::ui::screens::shell::page::pages::sessions) fn with_context(
    composer: Composer,
    context: impl IntoIterator<Item = Option<AnyElement>>,
    cx: &App,
) -> Composer {
    let context: Vec<AnyElement> = context.into_iter().flatten().collect();
    if context.is_empty() {
        return composer;
    }
    let unit = units(cx);
    composer.context(div().flex().flex_col().gap(unit(10.)).children(context))
}

/// The files waiting in a composer, as a row of chips, the `n`th with remove button
/// `remove_id + n`; `None` when there are none. `attachments` finds the list again when one
/// is removed.
pub(in crate::ui::screens::shell::page::pages::sessions) fn pending_files(
    paths: &[PathBuf],
    remove_id: usize,
    sending: bool,
    attachments: fn(&mut AppShell) -> &mut Vec<PathBuf>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<AnyElement> {
    if paths.is_empty() {
        return None;
    }
    let chips: Vec<AnyElement> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let remove = icon_button(
                remove_id + index,
                text(locale, Message::RemoveAttachment),
                IconName::X,
                cx,
            )
            .disabled(sending)
            .on_click(cx.listener(move |this, _, _, cx| {
                let attachments = attachments(this);
                // The list may have shrunk since this button was drawn.
                if index < attachments.len() {
                    attachments.remove(index);
                    cx.notify();
                }
            }));
            attachment_chip(path, remove, cx)
        })
        .collect();
    let unit = units(cx);
    Some(
        div()
            .flex()
            .flex_wrap()
            .gap(unit(6.))
            .children(chips)
            .into_any_element(),
    )
}

/// A file waiting in a composer, with the button that takes it out.
fn attachment_chip(path: &Path, remove: Button, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let name = SharedString::from(
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
    );
    // Not stored yet, so judged by its name; a picture Study can draw shows itself, anything
    // else shows its kind.
    let detected = study_core::sniff(&name, &[]);
    let leading = if detected.is_raster() {
        div()
            .flex_none()
            .size(unit(24.))
            .rounded(unit(study_ui::scale::RADIUS_SM))
            .overflow_hidden()
            .child(
                img(path.to_path_buf())
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            )
            .into_any_element()
    } else {
        study_ui::icon(detected.kind.icon())
            .size(unit(16.))
            .text_color(colors.muted_foreground)
            .into_any_element()
    };
    div()
        .max_w(relative(0.78))
        .min_w_0()
        .h(unit(34.))
        .pl(unit(10.))
        .pr(unit(4.))
        .flex()
        .items_center()
        .gap(unit(8.))
        .rounded(unit(study_ui::scale::RADIUS_MD))
        .border_1()
        .border_color(colors.border)
        .bg(colors.background)
        .text_size(unit(study_ui::scale::TEXT_SMALL))
        .child(leading)
        .child(div().min_w_0().text_ellipsis().child(name))
        .child(remove)
        .into_any_element()
}
