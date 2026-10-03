//! Naming a new project (a dialog), or renaming one (a page).

use super::super::ids;
use crate::ui::screens::shell::page::pages::components::{centered_top, show_dialog, status_line};
use crate::ui::screens::shell::page::*;
use gpui_kit::Window;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, WindowExt as _, button::ButtonVariants as _, input::Input,
};
use study_core::ProjectId;
use study_ui::{ContentPage, button, scaled_px};

impl AppShell {
    /// Renames a project, with its name in the field.
    pub(in crate::ui::screens::shell::page::pages::projects) fn project_rename_page(
        &self,
        id: ProjectId,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let page = ContentPage::new(
            text(locale, Message::RenameProject),
            text(locale, Message::ProjectNameDescription),
        )
        .icon(IconName::BookOpen)
        .workspace()
        .item(text(locale, Message::ProjectName))
        .item(
            Input::new(&self.projects.name_input)
                .id(ids::NAME_INPUT)
                .w_full()
                .max_w(scaled_px(cx, 640.))
                .h(scaled_px(cx, 40.))
                .aria_label(text(locale, Message::ProjectName)),
        )
        .footer_action(
            button(ids::SAVE, text(locale, Message::Save), cx)
                .primary()
                .disabled(self.projects.working())
                .on_click(cx.listener(move |this, _, _, cx| this.rename_project(id, cx))),
        )
        .footer_action(
            button(ids::CANCEL_EDIT, text(locale, Message::Cancel), cx)
                .disabled(self.projects.working())
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.show_project(id);
                    cx.notify();
                })),
        );
        status_line(page, self.projects.error, self.projects.busy, locale)
    }

    /// Opens the dialog that names a new project.
    pub(in crate::ui::screens::shell::page) fn open_project_create_dialog(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let locale = self.preferences.language;
        show_dialog(
            move |this, dialog, window, cx| {
                let state = &this.projects;
                let mut body = div()
                    .flex()
                    .flex_col()
                    .gap(scaled_px(cx, 8.))
                    .child(text(locale, Message::ProjectNameDescription))
                    .child(
                        Input::new(&state.create_input)
                            .id(ids::CREATE_INPUT)
                            .w_full()
                            .h(scaled_px(cx, 40.))
                            .aria_label(text(locale, Message::ProjectName)),
                    );
                if let Some(error) = state.create_error {
                    body = body.child(
                        div()
                            .text_color(cx.theme().colors.danger)
                            .child(text(locale, error)),
                    );
                }
                dialog
                    .title(text(locale, Message::NewProject))
                    .w(scaled_px(cx, 460.))
                    .margin_top(centered_top(window, 260., cx))
                    .child(body)
                    .footer(
                        div()
                            .flex()
                            .justify_end()
                            .gap(scaled_px(cx, 8.))
                            .child(
                                button(ids::CANCEL_EDIT, text(locale, Message::Cancel), cx)
                                    .on_click(|_, window, cx| window.close_dialog(cx)),
                            )
                            .child(
                                button(ids::SAVE, text(locale, Message::CreateProject), cx)
                                    .primary()
                                    .disabled(state.busy)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.create_project(window, cx)
                                    })),
                            ),
                    )
            },
            window,
            cx,
        );
        self.projects
            .create_input
            .update(cx, |input, cx| input.focus(window, cx));
    }
}
