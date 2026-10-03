//! A file's tile in the gallery: its preview on the quiet fill, large radius and no border,
//! then its name and, faint, its project and size; the hover tone under the pointer.

use super::media_preview;
use crate::features::media::MediaPreview;
use gpui_kit::component::{
    ActiveTheme as _,
    button::{Button, ButtonCustomVariant, ButtonVariants as _},
};
use gpui_kit::{App, ParentElement as _, SharedString, Styled as _, div};
use study_app::views::Source;
use study_localization::{Locale, Message, media_size, text};

/// `item` as a gallery tile: its preview, name, project and size.
pub(in crate::ui::screens::shell::page::pages::media_list) fn media_tile(
    id: impl Into<gpui_kit::ElementId>,
    item: &Source,
    preview: Option<&MediaPreview>,
    locale: Locale,
    cx: &App,
) -> Button {
    let unit = study_ui::units(cx);
    let colors = cx.theme().colors;
    let name = SharedString::from(item.name.clone());
    let project = item
        .project_name
        .clone()
        .unwrap_or_else(|| text(locale, Message::NoProject).to_owned());
    let size = media_size(locale, item.size_bytes);
    Button::new(id)
        .accessibility_label(name.clone())
        .tooltip(name.clone())
        .tab_stop(true)
        .w_full()
        .min_w_0()
        .h(unit(248.))
        .p(unit(6.))
        .rounded(unit(study_ui::scale::RADIUS_LG))
        .custom(
            ButtonCustomVariant::new(cx)
                .color(colors.background.opacity(0.))
                .foreground(colors.foreground)
                .hover(colors.secondary_hover)
                .active(colors.secondary_active),
        )
        .child(
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_start()
                .child(media_preview(item, preview, false, locale, cx))
                .child(
                    div()
                        .w_full()
                        .mt(unit(study_ui::scale::SPACE_XS))
                        .px(unit(study_ui::scale::SPACE_XXS))
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .text_size(unit(study_ui::scale::TEXT_UI))
                        .child(name),
                )
                .child(
                    div()
                        .w_full()
                        .mt(unit(2.))
                        .px(unit(study_ui::scale::SPACE_XXS))
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(study_ui::palette(cx).faint)
                        .flex()
                        .gap(unit(8.))
                        .child(div().flex_1().min_w_0().text_ellipsis().child(project))
                        .child(div().flex_shrink_0().child(size)),
                ),
        )
}
