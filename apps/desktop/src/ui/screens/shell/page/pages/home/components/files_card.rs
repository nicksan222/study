//! The newest files, as a section of media tiles, each drawn as itself where it can be: a
//! photo fills its tile, a rendered page sits on it as paper, as in the Library.

use super::super::ids;
use super::{ellipsis, note, page_link, tile_button};
use crate::features::dashboard::{RecentFile, Snapshot};
use crate::features::media::MediaPreview;
use crate::ui::screens::shell::page::pages::components::file_tile;
use crate::ui::screens::shell::page::pages::media_list::{is_page, page_picture};
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{ObjectFit, SharedString, StyledImage as _, img};
use study_localization::{joined, media_size};
use study_ui::Section;
use study_ui::{Gallery, units};

/// How tall a file's picture is on its tile, in design pixels.
const THUMB_HEIGHT: f32 = 110.;

impl AppShell {
    /// The newest files, each drawn as itself where it can be.
    pub(in crate::ui::screens::shell::page::pages::home) fn files_card(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let open = page_link(
            ids::OPEN_LIBRARY,
            text(locale, Message::OpenLibrary),
            Page::MediaList,
            cx,
        );
        let content = if snapshot.recent_files.is_empty() {
            note(text(locale, Message::NoFilesYet), cx).into_any_element()
        } else {
            snapshot
                .recent_files
                .iter()
                .fold(Gallery::new(ids::RECENT_FILES), |gallery, file| {
                    gallery.item(self.file_thumb(file, locale, cx))
                })
                .into_any_element()
        };
        Section::new(text(locale, Message::RecentFiles))
            .action(open)
            .child(content)
            .into_any_element()
    }

    /// A file as a media tile: its picture or first lines where it has them, else its kind's
    /// glyph; its name and, faint, its project and size.
    fn file_thumb(&self, file: &RecentFile, locale: Locale, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors;
        let faint = study_ui::palette(cx).faint;
        let unit = units(cx);
        let name = file.item.name.clone();
        let visual: AnyElement = match file.info.as_ref().map(|info| &info.preview) {
            Some(MediaPreview::Image { path, .. }) if is_page(file.item.kind) => {
                page_picture(path.clone(), THUMB_HEIGHT, cx).into_any_element()
            }
            Some(MediaPreview::Image { path, .. }) => img(path.clone())
                .size_full()
                .object_fit(ObjectFit::Cover)
                .into_any_element(),
            Some(MediaPreview::Text(snippet)) => div()
                .size_full()
                .p(unit(study_ui::scale::SPACE_SM))
                .overflow_hidden()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .line_height(unit(16.))
                .text_color(colors.muted_foreground)
                .child(SharedString::from(snippet.trim().to_owned()))
                .into_any_element(),
            _ => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(file_tile(file.item.kind, 56., cx))
                .into_any_element(),
        };
        let detail = joined(&[
            file.item.project_name.clone().unwrap_or_default(),
            media_size(locale, file.item.size_bytes),
        ]);
        tile_button((ids::FILE, file.item.id.get() as u64), name.clone(), cx)
            .w_full()
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .overflow_hidden()
                    .rounded(unit(study_ui::scale::RADIUS_LG))
                    .child(
                        div()
                            .w_full()
                            .relative()
                            .h(unit(THUMB_HEIGHT))
                            .overflow_hidden()
                            .rounded(unit(study_ui::scale::RADIUS_LG))
                            .bg(study_ui::palette(cx).fill)
                            .child(visual),
                    )
                    .child(
                        div()
                            .w_full()
                            .px(unit(study_ui::scale::SPACE_SM))
                            .py(unit(study_ui::scale::SPACE_XS))
                            .flex()
                            .flex_col()
                            .items_start()
                            .child(ellipsis(name, study_ui::scale::TEXT_UI, None, cx))
                            .child(ellipsis(
                                detail,
                                study_ui::scale::TEXT_CAPTION,
                                Some(faint),
                                cx,
                            )),
                    ),
            )
            .on_click(cx.listener(|this, _, _, cx| {
                this.navigate(Page::MediaList, cx);
            }))
            .into_any_element()
    }
}
