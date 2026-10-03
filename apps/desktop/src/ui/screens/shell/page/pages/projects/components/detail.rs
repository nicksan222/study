//! One project: starting a session in it, its four pieces of study material (each with its
//! status, opening on its Study page) and its
//! quiz and files, renaming it, and deleting it.

use super::super::ids;
use super::super::page::ProjectsMode;
use crate::ui::screens::shell::page::pages::components::{Alert, named_field, quiet};
use crate::ui::screens::shell::page::pages::components::{kind_icon, kind_label};
use crate::ui::screens::shell::page::*;
use gpui_kit::SharedString;
use gpui_kit::component::date_picker::DatePicker;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, button::ButtonVariants as _};
use study_app::views::ArtifactKind;
use study_core::ProjectId;
use study_ui::{ContentPage, button, icon_button};

/// Width of the column of kind buttons in a project's material list, in design units.
const KIND_COLUMN: f32 = 140.;

impl AppShell {
    /// One project: what to do in it, its exam day, and renaming or deleting it.
    pub(in crate::ui::screens::shell::page::pages::projects) fn project_detail_page(
        &self,
        id: ProjectId,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let name = self
            .project(id)
            .map(|project| project.name.clone())
            .unwrap_or_default();
        let mut page =
            ContentPage::new(name, text(locale, Message::ProjectDetailDescription))
                .icon(IconName::BookOpen)
                .workspace()
                .item(quiet(text(locale, Message::ProjectEmptyDescription), cx))
                .item(self.project_material(id, locale, cx))
                .item(self.exam_day(locale, cx))
                .footer_action(
                    button(ids::VIEW_SESSIONS, text(locale, Message::NewSession), cx)
                        .icon(IconName::NotebookText)
                        .primary()
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.start_session_in(id, window, cx)
                        })),
                )
                .footer_action(
                    button(ids::OPEN_QUIZ, text(locale, Message::OpenProjectQuiz), cx)
                        .icon(Page::Practice.icon())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.navigate(Page::Practice, cx);
                            this.open_project_practice(id, cx)
                        })),
                )
                .footer_action(
                    button(ids::OPEN_STUDY, text(locale, Message::OpenProjectCards), cx)
                        .icon(Page::Flashcards.icon())
                        .on_click(cx.listener(|this, _, _, cx| this.show_reviews(cx))),
                )
                .footer_action(
                    button(ids::VIEW_FILES, text(locale, Message::ViewProjectFiles), cx)
                        .icon(IconName::Images)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.show_project_media(id, window, cx)
                        })),
                )
                // Renaming and deleting sit in the title bar as icon buttons.
                .action(
                    icon_button(
                        ids::RENAME,
                        text(locale, Message::RenameProject),
                        IconName::SquarePen,
                        cx,
                    )
                    .disabled(self.projects.working())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.start_project_rename(id, window, cx)
                    })),
                )
                .action(
                    icon_button(
                        ids::DELETE,
                        text(locale, Message::DeleteProject),
                        IconName::Trash,
                        cx,
                    )
                    .disabled(!self.can_delete_project(id))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.projects.mode = ProjectsMode::ConfirmDelete(id);
                        this.projects.error = None;
                        cx.notify();
                    })),
                );
        if let Some(error) = self.projects.error {
            page = page.failure(text(locale, error));
        }
        page
    }

    /// The project's four kinds of study material, each with its status: up to
    /// date, outdated and by what, being written or updated, or not made yet. A row
    /// opens the piece on its page.
    fn project_material(
        &self,
        id: ProjectId,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let unit = study_ui::units(cx);
        let colors = cx.theme().colors;
        let mut rows = div().w_full().flex().flex_col().gap(unit(4.));
        for (place, &kind) in ArtifactKind::ALL.iter().enumerate() {
            let line = self.material_line(id, kind);
            let (status, tint) = match &line {
                Some(line) => (
                    line.status.label(locale),
                    if line.status.failed() {
                        colors.danger
                    } else {
                        colors.muted_foreground
                    },
                ),
                None => (
                    text(locale, Message::MaterialNotMade).to_owned(),
                    colors.muted_foreground,
                ),
            };
            let opened = line.as_ref().map(|line| line.open);
            rows = rows.child(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .gap(unit(10.))
                    // One column as wide as the longest label (Italian "Flashcard"), so the
                    // facts after it start at the same x on every row.
                    .child(
                        div().w(unit(KIND_COLUMN)).flex_none().child(
                            button(
                                (ids::MATERIAL_ROW, place as u64),
                                text(locale, kind_label(kind)),
                                cx,
                            )
                            .icon(kind_icon(kind))
                            .on_click(cx.listener(
                                move |this, _, _, cx| match opened {
                                    Some(artifact) => this.show_material(kind, artifact, cx),
                                    None => this.show_unmade_material(kind, id, cx),
                                },
                            )),
                        ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .text_color(tint)
                            .child(SharedString::from(status)),
                    ),
            );
        }
        div()
            .w_full()
            .max_w(unit(560.))
            .flex()
            .flex_col()
            .gap(unit(6.))
            .child(study_ui::heading(
                text(locale, Message::ProjectMaterial),
                cx,
            ))
            .child(rows)
            .into_any_element()
    }

    /// The day of the project's exam, picked from a calendar, and what it is for.
    fn exam_day(&self, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let unit = study_ui::units(cx);
        let colors = cx.theme().colors;
        div()
            .w_full()
            .max_w(unit(420.))
            .flex()
            .flex_col()
            .gap(unit(6.))
            .child(study_ui::heading(text(locale, Message::ExamDay), cx))
            .child(named_field(
                ids::EXAM_DAY,
                text(locale, Message::ExamDay),
                DatePicker::new(&self.projects.exam_picker)
                    .cleanable(true)
                    .placeholder(text(locale, Message::ExamDayPlaceholder)),
            ))
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(colors.muted_foreground)
                    .child(text(locale, Message::ExamDayHint)),
            )
            .into_any_element()
    }

    /// Asks before a project is deleted, in an alert over its page.
    pub(in crate::ui::screens::shell::page) fn projects_alert(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<Alert> {
        let ProjectsMode::ConfirmDelete(id) = self.projects.mode else {
            return None;
        };
        self.project(id)?;
        let confirm = button(
            ids::CONFIRM_DELETE,
            text(locale, Message::DeleteProject),
            cx,
        )
        .danger()
        .disabled(!self.can_delete_project(id))
        .on_click(cx.listener(move |this, _, _, cx| this.delete_project(id, cx)));
        let alert = Alert::new(
            text(locale, Message::AlertDeleteProject),
            text(locale, Message::ConfirmDeleteProject),
            confirm,
            ids::CANCEL_DELETE,
            move |this, cx| {
                this.show_project(id);
                cx.notify();
            },
        );
        Some(
            alert
                .locked(self.projects.working())
                .failure(self.projects.error.map(|error| text(locale, error).into())),
        )
    }
}
