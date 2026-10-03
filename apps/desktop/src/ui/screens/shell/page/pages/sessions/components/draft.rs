//! The draft of a new session, laid out as the empty notebook it becomes: its project and a
//! heading at the top, the ways to start under them, and the composer docked at the bottom
//! where the open session keeps it, so nothing moves when the first note goes in.

use super::super::ids;
use super::super::page::SessionView;
use super::conversation::notebook_column;
use super::{META_GUTTER, insert_mention};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    Disableable as _,
    button::ButtonVariants as _,
    menu::{DropdownMenu as _, PopupMenuItem},
};
use gpui_kit::{AnyElement, StatefulInteractiveElement as _};
use study_core::{Mention, ProjectId};
use study_ui::{ChoiceCard, ChoiceGrid, button, units};

impl AppShell {
    /// The draft of a new session in `project_id`, which the picker over the heading
    /// changes.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn draft_body(
        &self,
        project_id: Option<ProjectId>,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let can_edit = self.sessions.can_edit();
        let start = ChoiceGrid::new()
            .card(
                ChoiceCard::new(
                    ids::START_RECORDING,
                    text(locale, Message::StartWithRecording),
                )
                .description(text(locale, Message::StartWithRecordingDescription))
                .icon(IconName::Mic)
                .action()
                .disabled(!self.can_start_recording())
                .on_click(cx.listener(|this, _, _, cx| this.start_recording(cx))),
            )
            .card(
                ChoiceCard::new(ids::START_FILES, text(locale, Message::StartWithFiles))
                    .description(text(locale, Message::StartWithFilesDescription))
                    .icon(IconName::Paperclip)
                    .action()
                    .disabled(!can_edit)
                    .on_click(
                        cx.listener(|this, _, window, cx| this.choose_attachments(window, cx)),
                    ),
            )
            .card({
                let input = self.sessions.composer.clone();
                ChoiceCard::new(ids::START_ASK, text(locale, Message::StartWithQuestion))
                    .description(text(locale, Message::StartWithQuestionDescription))
                    .icon(IconName::Sparkles)
                    .action()
                    .disabled(!can_edit)
                    .on_click(move |_, window, cx| {
                        insert_mention(&input, Mention::Assistant, window, cx)
                    })
            });
        let intro = notebook_column(cx)
            .pt(unit(study_ui::scale::SPACE_XL))
            .pb(unit(study_ui::scale::SPACE_LG))
            .child(
                div()
                    // The notes' width, short of the margin their time takes.
                    .pr(unit(META_GUTTER))
                    .flex()
                    .flex_col()
                    .items_start()
                    .child(
                        study_ui::PageIntro::headline(text(locale, Message::StartSession))
                            .context(self.draft_project_picker(project_id, locale, cx))
                            .description(text(locale, Message::StartSessionDescription)),
                    )
                    .child(
                        div()
                            .w_full()
                            .mt(unit(study_ui::scale::SPACE_LG))
                            .child(start),
                    ),
            );
        div()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .id(ids::TRANSCRIPT_SCROLL)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(intro),
            )
            .child(self.notebook_footer(locale, None, cx))
            .into_any_element()
    }

    /// The project the new session goes in, as a quiet button over the heading that opens
    /// the list of projects.
    fn draft_project_picker(
        &self,
        project_id: Option<ProjectId>,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let unit = units(cx);
        let project_name = project_id
            .and_then(|id| self.sessions.projects.iter().find(|p| p.id == id))
            .map(|project| project.name.clone())
            .unwrap_or_else(|| text(locale, Message::ChooseProject).to_owned());
        let view = cx.entity().downgrade();
        let projects: Vec<(ProjectId, String)> = self
            .sessions
            .projects
            .iter()
            .map(|project| (project.id, project.name.clone()))
            .collect();
        button(ids::PROJECT_PICKER, project_name, cx)
            .ghost()
            .icon(IconName::BookOpen)
            .tooltip(text(locale, Message::ChooseProject))
            .child(gpui_kit::component::Icon::new(IconName::ChevronDown).size(unit(14.)))
            .disabled(!self.sessions.can_edit())
            // Its text, not its hover fill, lines up with the heading under it.
            .ml(unit(-study_ui::scale::SPACE_SM))
            .dropdown_menu(move |mut menu, _, _| {
                for (id, name) in &projects {
                    let id = *id;
                    let view = view.clone();
                    menu = menu.item(
                        PopupMenuItem::new(name.clone())
                            .checked(Some(id) == project_id)
                            .on_click(move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.sessions.view = SessionView::Draft {
                                        project_id: Some(id),
                                    };
                                    cx.notify();
                                });
                            }),
                    );
                }
                menu
            })
    }
}
