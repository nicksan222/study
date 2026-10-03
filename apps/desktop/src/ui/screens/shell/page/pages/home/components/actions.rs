//! The things people do most, as quiet buttons beside the day's learning action.

use super::super::ids;
use crate::features::dashboard::Snapshot;
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::component::Disableable as _;
use study_ui::{button, units};

/// The things people do most.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum QuickAction {
    NewSession,
    AddFiles,
    NewProject,
}

impl QuickAction {
    const ALL: [Self; 3] = [Self::NewSession, Self::AddFiles, Self::NewProject];

    fn id(self) -> usize {
        match self {
            Self::NewSession => ids::QUICK_SESSION,
            Self::AddFiles => ids::ADD_FILES,
            Self::NewProject => ids::NEW_PROJECT,
        }
    }

    fn label(self) -> Message {
        match self {
            Self::NewSession => Message::NewSession,
            Self::AddFiles => Message::AddFiles,
            Self::NewProject => Message::NewProjectAction,
        }
    }

    fn icon(self) -> IconName {
        match self {
            Self::NewSession => IconName::SquarePen,
            Self::AddFiles => IconName::Paperclip,
            Self::NewProject => IconName::FolderOpen,
        }
    }
}

impl AppShell {
    /// The things people do most, as quiet buttons: a glyph and a label on the hover tone.
    pub(in crate::ui::screens::shell::page::pages::home) fn quick_actions(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let unit = units(cx);
        let target = snapshot.busiest_project();
        QuickAction::ALL
            .into_iter()
            .map(|action| {
                let disabled = action == QuickAction::NewSession && target.is_none();
                button(action.id(), text(locale, action.label()), cx)
                    .icon(study_ui::icon(action.icon()))
                    .h(unit(32.))
                    .text_size(unit(study_ui::scale::TEXT_UI))
                    .disabled(disabled)
                    .on_click(cx.listener(move |this, _, window, cx| match action {
                        QuickAction::NewSession => {
                            if let Some(project) = target {
                                this.start_session_in(project, window, cx);
                            }
                        }
                        QuickAction::AddFiles => {
                            this.navigate(Page::MediaList, cx);
                            this.choose_media_file(window, cx);
                        }
                        QuickAction::NewProject => {
                            this.navigate(Page::Projects, cx);
                            this.start_project_create(window, cx);
                        }
                    }))
                    .into_any_element()
            })
            .collect()
    }
}
