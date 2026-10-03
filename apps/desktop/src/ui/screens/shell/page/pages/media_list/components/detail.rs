//! One Library file: its preview, its project, and what was read from it.

use super::super::ids;
use super::media_preview;
use crate::ui::screens::shell::page::pages::components::{
    cited_blocks, cited_start, section_heading, status_line,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::SharedString;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Icon, Sizable as _,
    button::ButtonVariants as _,
    menu::{DropdownMenu as _, PopupMenuItem},
};
use gpui_kit::prelude::FluentBuilder as _;
use study_app::views::{Document, Source};
use study_core::SourceId;
use study_localization::{anchor_label, media_size};
use study_ui::{ContentPage, button, icon_button, scaled_px, units};

/// Most blocks of what was read shown under a file.
const MAX_BLOCKS_SHOWN: usize = 400;

impl AppShell {
    /// One file's page; the whole Library when the file is gone.
    pub(in crate::ui::screens::shell::page::pages::media_list) fn media_detail_page(
        &self,
        id: SourceId,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let Some(item) = self.media.item(id) else {
            return self.media_list_page(locale, cx);
        };
        let mut page = ContentPage::new(item.name.clone(), media_size(locale, item.size_bytes))
            .icon(IconName::File)
            .workspace()
            // Its actions sit in the title bar as icon buttons, each named by its tooltip.
            .action(
                icon_button(
                    ids::BACK_TO_ALL,
                    text(locale, Message::AllMedia),
                    IconName::ArrowLeft,
                    cx,
                )
                .disabled(self.media.working())
                .on_click(cx.listener(|this, _, _, cx| this.show_all_media(cx))),
            )
            .action(match item.uri.clone() {
                // A page or video opens where it came from.
                Some(uri) => icon_button(
                    ids::OPEN,
                    text(locale, Message::OpenPage),
                    IconName::Globe,
                    cx,
                )
                .on_click(move |_, _, cx| cx.open_url(&uri)),
                None => icon_button(
                    ids::OPEN,
                    text(locale, Message::OpenMedia),
                    IconName::ExternalLink,
                    cx,
                )
                .disabled(self.media.busy)
                .on_click(cx.listener(move |this, _, _, cx| this.open_media_original(id, cx))),
            });
        let association = self.project_picker(item, locale, cx);
        let unit = units(cx);
        // Opened from a citation: the passage comes first, above the file's preview.
        let cited_here = self
            .media
            .cited
            .as_ref()
            .is_some_and(|(source, _)| *source == id);
        let document = self.media.documents.get(&id);
        if cited_here && let Some(document) = document {
            page = self.read_text(page, id, document, locale, cx);
        }
        page = page.item(
            div()
                .flex()
                .flex_wrap()
                .gap(unit(24.))
                .w_full()
                .child(
                    div()
                        .flex_1()
                        .min_w(unit(280.))
                        .h(unit(510.))
                        .rounded(unit(study_ui::scale::RADIUS_LG))
                        .overflow_hidden()
                        .child(media_preview(
                            item,
                            self.media.previews.get(&id),
                            true,
                            locale,
                            cx,
                        )),
                )
                .child(
                    div()
                        .w(unit(200.))
                        .flex()
                        .flex_col()
                        .gap(unit(12.))
                        .child(
                            div()
                                .text_color(cx.theme().colors.muted_foreground)
                                .text_size(unit(study_ui::scale::TEXT_SMALL))
                                .child(text(locale, Message::AssociateWithProject)),
                        )
                        .child(association),
                ),
        );
        if !cited_here && let Some(document) = document {
            page = self.read_text(page, id, document, locale, cx);
        }
        page = page.action(
            icon_button(
                ids::DELETE,
                text(locale, Message::DeleteMedia),
                IconName::Trash,
                cx,
            )
            .disabled(self.media.working())
            .on_click(cx.listener(move |this, _, _, cx| {
                this.confirm_delete_media(id, cx);
            })),
        );
        status_line(page, self.media.error, self.media.busy, locale)
    }

    /// The button that picks the project a file belongs to, naming the one it is in.
    fn project_picker(
        &self,
        item: &Source,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let id = item.id;
        let view = cx.entity().downgrade();
        let choices = self.media.project_choices(Message::NoProject, locale);
        let project_label = item
            .project_name
            .clone()
            .unwrap_or_else(|| text(locale, Message::NoProject).to_owned());
        let selected_project = item.project_id;
        button(ids::PROJECT_PICKER, project_label, cx)
            .child(Icon::new(IconName::ChevronDown).size(scaled_px(cx, 14.)))
            .disabled(self.media.working())
            .dropdown_menu(move |menu, _, _| {
                choices.iter().fold(menu, |menu, (project_id, label)| {
                    let (view, project_id) = (view.clone(), *project_id);
                    menu.item(
                        PopupMenuItem::new(label.clone())
                            .checked(project_id == selected_project)
                            .on_click(move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.associate_media(id, project_id, cx)
                                });
                            }),
                    )
                })
            })
    }

    /// What was read from file `id`, block by block with where each is in the file; from
    /// the cited passage, marked, when a citation opened it.
    fn read_text(
        &self,
        mut page: ContentPage,
        id: SourceId,
        document: &Document,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let unit = units(cx);
        page = page.item(section_heading(text(locale, Message::ReadFromFile), cx));
        // A citation opened it: the cited passage first, marked, and a way to the top.
        let cited = self
            .media
            .cited
            .as_ref()
            .filter(|(source, _)| *source == id)
            .map(|(_, at)| at);
        let marks = cited_blocks(&document.blocks, cited);
        let start = cited_start(&document.blocks, cited).filter(|_| !self.media.cited_earlier);
        if start.is_some() {
            page = page.item(
                button(ids::FROM_START, text(locale, Message::ShowFromStart), cx)
                    .ghost()
                    .small()
                    .icon(IconName::ArrowUp)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.media.cited_earlier = true;
                        cx.notify();
                    })),
            );
        }
        let colors = cx.theme().colors;
        let wash = study_ui::palette(cx).highlighter_wash;
        for (ordinal, block) in document
            .blocks
            .iter()
            .enumerate()
            .skip(start.unwrap_or(0))
            .take(MAX_BLOCKS_SHOWN)
        {
            let marked = marks.contains(&ordinal);
            page = page.item(
                div()
                    .w_full()
                    .flex()
                    .gap(unit(12.))
                    .when(marked, |row| {
                        row.px(unit(8.))
                            .py(unit(6.))
                            .rounded(unit(study_ui::scale::RADIUS_SM))
                            // The cited passage, washed as its citation is.
                            .bg(wash)
                    })
                    .child(
                        div()
                            .flex_none()
                            .w(unit(96.))
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .text_color(colors.muted_foreground)
                            .children(anchor_label(locale, &block.anchor)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .whitespace_normal()
                            .child(SharedString::from(block.text.clone())),
                    ),
            );
        }
        page
    }
}
