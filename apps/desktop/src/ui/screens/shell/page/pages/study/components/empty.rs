//! A project with nothing of the page's kind made yet: its name, and Make, or why there is
//! nothing to make it from.

use super::super::ids;
use crate::ui::screens::shell::page::pages::components::{kind_icon, quiet};
use crate::ui::screens::shell::page::*;
use gpui_kit::SharedString;
use gpui_kit::component::{Disableable as _, button::ButtonVariants as _};
use study_core::ProjectId;
use study_ui::{ContentPage, button};

impl AppShell {
    /// The project's name and Make, which writes it from the whole project.
    pub(in crate::ui::screens::shell::page::pages::study) fn material_empty(
        &self,
        page: ContentPage,
        project: Option<ProjectId>,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let state = &self.study;
        let name = project
            .and_then(|id| state.projects.iter().find(|project| project.id == id))
            .map(|project| project.name.clone());
        let Some((project, name)) = project.zip(name) else {
            return page;
        };
        let kind = state.kind;
        let page = page.item(study_ui::PageIntro::title(SharedString::from(name)));
        // Nothing in the project to write it from: say so instead of offering Make.
        if !state.offers(project) {
            return page.item(quiet(text(locale, Message::MaterialNothingToMake), cx));
        }
        let make = button(ids::MAKE, text(locale, Message::MakeMaterial), cx)
            .primary()
            .icon(kind_icon(kind))
            .disabled(state.making || self.workers.starting())
            .on_click(cx.listener(move |this, _, _, cx| this.update_material(project, kind, cx)));
        page.item(make)
    }
}
