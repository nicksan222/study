//! The whole Library: its actions as icon buttons in the title bar, then, in the page
//! column, the project filter and search over a tile per file, each tile's menu button
//! showing on hover or keyboard focus.

use super::super::ids;
use super::media_tile;
use crate::ui::screens::shell::page::*;
use gpui_kit::StatefulInteractiveElement as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::Input;
use gpui_kit::component::{
    Disableable as _, Icon,
    button::ButtonVariants as _,
    menu::{ContextMenuExt as _, DropdownMenu as _, PopupMenu, PopupMenuItem},
};
use study_core::SourceId;
use study_ui::{ContentPage, Gallery, button, icon_button, scaled_px};

/// The group each file's card is, so its menu button shows while the card is hovered.
const CARD_GROUP: &str = "media-card";

impl AppShell {
    /// Every file the filter and search let through, as a gallery.
    pub(in crate::ui::screens::shell::page::pages::media_list) fn media_list_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let mut page = ContentPage::new(text(locale, Message::MediaList), "")
            .icon(IconName::Images)
            .workspace();
        // Reloads keep the gallery on screen; only the first load has nothing to show.
        if !self.media.loaded {
            return page.status(text(locale, Message::LoadingMedia));
        }
        if self.visible_media(cx).next().is_none() && self.media.error.is_none() {
            page = page.empty(text(
                locale,
                if self.media.search.read(cx).value().trim().is_empty()
                    && self.media.filter_project.is_none()
                {
                    Message::NoMediaYet
                } else {
                    Message::NoMatchingMedia
                },
            ));
        }
        // The page's actions sit in the title bar as icon buttons, each named by its tooltip.
        page = page.action(
            icon_button(
                ids::NEW_NOTE,
                text(locale, Message::NewNote),
                IconName::SquarePen,
                cx,
            )
            .disabled(self.media.busy)
            .on_click(cx.listener(|this, _, window, cx| this.start_note(window, cx))),
        );
        page = page.action(
            icon_button(
                ids::ADD_LINK,
                text(locale, Message::AddLink),
                IconName::Globe,
                cx,
            )
            .disabled(self.media.busy)
            .on_click(cx.listener(|this, _, window, cx| this.start_link(window, cx))),
        );
        page = page.action(
            icon_button(
                ids::UPLOAD,
                text(locale, Message::UploadMedia),
                IconName::Plus,
                cx,
            )
            .disabled(self.media.busy || self.media.error == Some(Message::MediaLoadError))
            .on_click(cx.listener(|this, _, window, cx| this.start_media_upload(window, cx))),
        );
        // The toolbar and the gallery share the page column.
        page = page.item(
            study_ui::page_column(study_ui::Column::Page)
                .flex()
                .flex_col()
                .child(self.media_toolbar(locale, cx))
                .child(self.media_gallery(locale, cx)),
        );
        if let Some(error) = self.media.error {
            page = page.failure(text(locale, error));
            // Only a failed load is undone by loading again.
            if error == Message::MediaLoadError {
                page = page.item(
                    button(ids::RETRY_LOAD, text(locale, Message::Retry), cx)
                        .on_click(cx.listener(|this, _, _, cx| this.load_media(cx))),
                );
            }
        }
        page
    }

    /// Above the gallery: the project filter, how many files show, and the search.
    fn media_toolbar(&self, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let view = cx.entity().downgrade();
        let selected_project = self.media.filter_project;
        let choices = self.media.project_choices(Message::AllMedia, locale);
        let label = choices
            .iter()
            .find(|(id, _)| *id == selected_project)
            .unwrap_or(&choices[0])
            .1
            .clone();
        div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(scaled_px(cx, 12.))
            .mb(scaled_px(cx, 8.))
            .child(
                button(ids::PROJECT_FILTER, label, cx)
                    .ghost()
                    .child(Icon::new(IconName::ChevronDown).size(scaled_px(cx, 14.)))
                    .dropdown_menu(move |menu, _, _| {
                        choices.iter().fold(menu, |menu, (id, label)| {
                            let (view, id) = (view.clone(), *id);
                            menu.item(
                                PopupMenuItem::new(label.clone())
                                    .checked(id == selected_project)
                                    .on_click(move |_, _, cx| {
                                        let _ = view.update(cx, |this, cx| {
                                            this.media.filter_project = id;
                                            cx.notify();
                                        });
                                    }),
                            )
                        })
                    }),
            )
            .child(
                div()
                    .text_size(scaled_px(cx, study_ui::scale::TEXT_CAPTION))
                    .text_color(study_ui::palette(cx).faint)
                    .child(study_localization::file_count(
                        locale,
                        self.visible_media(cx).count(),
                    )),
            )
            .child(div().flex_1())
            .child(
                Input::new(&self.media.search)
                    .id(ids::SEARCH)
                    .aria_label(text(locale, Message::SearchMedia))
                    .prefix(Icon::new(IconName::Search).size(scaled_px(cx, 15.)))
                    .cleanable(true)
                    .w(scaled_px(cx, 240.))
                    .h(scaled_px(cx, 34.)),
            )
    }

    /// A tile per file the filter and search let through, each with its menu.
    fn media_gallery(&self, locale: Locale, cx: &mut Context<Self>) -> Gallery {
        let mut gallery = Gallery::new(ids::GALLERY);
        for item in self.visible_media(cx) {
            let id = item.id;
            let disabled = self.media.working();
            gallery = gallery.item(
                div()
                    .id((ids::CARD, id.get() as u64))
                    .group(CARD_GROUP)
                    // The card carries the file's menu on a right click.
                    .test_support()
                    .aria_label(study_localization::joined(&[
                        item.name.clone(),
                        text(locale, Message::MediaActions).to_owned(),
                    ]))
                    .child(
                        media_tile(
                            (ids::TILE, id.get() as u64),
                            item,
                            self.media.previews.get(&id),
                            locale,
                            cx,
                        )
                        .disabled(disabled)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.open_media_detail(id, cx);
                        })),
                    )
                    .child(
                        div()
                            .absolute()
                            .top(scaled_px(cx, 12.))
                            .right(scaled_px(cx, 12.))
                            .child(
                                icon_button(
                                    (ids::ACTIONS, id.get() as u64),
                                    text(locale, Message::MediaActions),
                                    IconName::Ellipsis,
                                    cx,
                                )
                                // Out of sight until the tile is hovered or the
                                // keyboard reaches the button, as a note's actions are.
                                .opacity(0.)
                                .group_hover(CARD_GROUP, |style| style.opacity(1.))
                                .focus_visible(|style| style.opacity(1.))
                                .disabled(disabled)
                                .dropdown_menu(self.media_actions_menu(id, locale, cx)),
                            ),
                    )
                    .context_menu(self.media_actions_menu(id, locale, cx)),
            );
        }
        gallery
    }

    /// A file's menu, on its tile's button and on a right click: open it, or delete it.
    fn media_actions_menu(
        &self,
        id: SourceId,
        locale: Locale,
        cx: &Context<Self>,
    ) -> impl Fn(PopupMenu, &mut Window, &mut Context<PopupMenu>) -> PopupMenu + 'static {
        let view = cx.entity().downgrade();
        let disabled = self.media.working();
        move |menu, _, _| {
            let open_view = view.clone();
            let delete_view = view.clone();
            menu.item(
                PopupMenuItem::new(text(locale, Message::OpenMedia))
                    .disabled(disabled)
                    .on_click(move |_, _, cx| {
                        let _ = open_view.update(cx, |this, cx| this.open_media_original(id, cx));
                    }),
            )
            .separator()
            .item(
                PopupMenuItem::new(text(locale, Message::DeleteMedia))
                    .disabled(disabled)
                    .on_click(move |_, _, cx| {
                        let _ =
                            delete_view.update(cx, |this, cx| this.confirm_delete_media(id, cx));
                    }),
            )
        }
    }
}
