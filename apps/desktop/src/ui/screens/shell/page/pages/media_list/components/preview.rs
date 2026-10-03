//! A file's preview, small on its gallery tile and large on its page: its picture, its first
//! lines, or, for a file with neither (a recording, a web page), its kind's monochrome glyph
//! on a neutral tile. A rendered page sits on its tile as paper, inset with a hairline edge
//! ([`page_picture`], which Home's tiles share). Markup is never shown as text: a web page reads as its glyph and where
//! it came from, and its name is under the tile.

use super::super::ids;
use crate::features::media::MediaPreview;
use crate::ui::screens::shell::page::pages::components::file_tile;
use gpui_kit::component::{ActiveTheme as _, Icon};
use gpui_kit::{
    AnyElement, App, Div, InteractiveElement as _, IntoElement as _, ObjectFit, ParentElement as _,
    SharedString, StatefulInteractiveElement as _, Styled as _, StyledImage as _, assets::IconName,
    div, img,
};
use std::path::PathBuf;
use study_app::views::Source;
use study_core::SourceKind;
use study_localization::{Locale, Message, text};

/// The site a web page came from, such as `en.wikipedia.org`, when it has an address.
fn site(item: &Source) -> Option<String> {
    crate::features::media::site(item.uri.as_deref()?)
}

/// How tall a preview is on its gallery tile, in design pixels.
const TILE_HEIGHT: f32 = 180.;

/// Whether a picture of `kind` is a rendered page (a PDF's first page, say) rather than a
/// photo.
pub(in crate::ui::screens::shell::page::pages) fn is_page(kind: SourceKind) -> bool {
    kind != SourceKind::Image
}

/// A rendered page at `path` as paper on a preview tile `height` design pixels tall: inset
/// 12px from the tile's edge, at its own proportions, with a hairline at its edge so a white
/// page still reads on the light theme's white. Home and the Library's tiles both draw it.
pub(in crate::ui::screens::shell::page::pages) fn page_picture(
    path: PathBuf,
    height: f32,
    cx: &App,
) -> Div {
    let unit = study_ui::units(cx);
    let inset = study_ui::scale::SPACE_SM;
    div()
        .absolute()
        .inset_0()
        .p(unit(inset))
        .flex()
        .items_center()
        .justify_center()
        .child(
            img(path)
                // A definite height, so the width follows the page's proportions and the
                // hairline hugs the page rather than the tile.
                .h(unit(height - 2. * inset))
                .max_w_full()
                .border_1()
                .border_color(cx.theme().colors.border)
                .object_fit(ObjectFit::Contain),
        )
}

/// `item` as its `preview` shows it: its picture, its first lines, or its kind; a loading
/// line until the preview is ready. `large` draws it for the file's page.
pub(in crate::ui::screens::shell::page::pages::media_list) fn media_preview(
    item: &Source,
    preview: Option<&MediaPreview>,
    large: bool,
    locale: Locale,
    cx: &App,
) -> AnyElement {
    let unit = study_ui::units(cx);
    let colors = cx.theme().colors;
    let radius = unit(if large {
        study_ui::scale::RADIUS_LG
    } else {
        study_ui::scale::RADIUS_MD
    });
    let surface = div()
        .relative()
        .w_full()
        .flex_shrink_0()
        .rounded(radius)
        .overflow_hidden()
        .bg(study_ui::palette(cx).fill);
    let surface = if large {
        surface.h_full()
    } else {
        surface.h(unit(TILE_HEIGHT))
    };

    match preview {
        // A small rendered page sits on the tile as paper; a photo or a large page fills it.
        Some(MediaPreview::Image { path, .. }) if !large && is_page(item.kind) => surface
            .child(page_picture(path.clone(), TILE_HEIGHT, cx))
            .into_any_element(),
        Some(MediaPreview::Image { path, .. }) => surface
            .child(
                img(path.clone())
                    .absolute()
                    .size_full()
                    .rounded(radius)
                    .object_fit(ObjectFit::Contain),
            )
            .into_any_element(),
        Some(MediaPreview::Text(text_preview)) => {
            let text_surface = || {
                div()
                    .size_full()
                    .p(unit(if large {
                        study_ui::scale::SPACE_LG
                    } else {
                        study_ui::scale::SPACE_SM
                    }))
                    .text_size(unit(if large {
                        study_ui::scale::TEXT_UI
                    } else {
                        study_ui::scale::TEXT_CAPTION
                    }))
                    .line_height(unit(if large { 20. } else { 16. }))
                    .text_color(colors.muted_foreground)
            };
            if large {
                surface
                    .child(
                        text_surface()
                            .id(ids::TEXT_PREVIEW)
                            .overflow_y_scroll()
                            .child(text_preview.clone()),
                    )
                    .into_any_element()
            } else {
                surface
                    .child(text_surface().overflow_hidden().child(text_preview.clone()))
                    .into_any_element()
            }
        }
        Some(_) => surface
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XS))
            .items_center()
            .justify_center()
            .child(file_tile(item.kind, 56., cx))
            .children(site(item).map(|site| {
                div()
                    .max_w_full()
                    .px(unit(study_ui::scale::SPACE_SM))
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .overflow_hidden()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(study_ui::palette(cx).faint)
                    .child(SharedString::from(site))
            }))
            .into_any_element(),
        None => status_surface(surface, text(locale, Message::LoadingPreview), large, cx),
    }
}

/// `surface` holding a file icon over `label`, while there is nothing else to show.
fn status_surface(
    surface: gpui_kit::Div,
    label: &'static str,
    large: bool,
    cx: &App,
) -> AnyElement {
    let unit = study_ui::units(cx);
    surface
        .flex()
        .flex_col()
        .gap(unit(study_ui::scale::SPACE_SM))
        .items_center()
        .justify_center()
        .text_size(unit(if large {
            study_ui::scale::TEXT_UI
        } else {
            study_ui::scale::TEXT_CAPTION
        }))
        .text_color(study_ui::palette(cx).faint)
        .child(Icon::new(IconName::FileText).size(unit(24.)))
        .child(label)
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::{SourceId, SourceOrigin, mime};

    fn source(kind: SourceKind, mime: &str, uri: Option<&str>) -> Source {
        Source {
            id: SourceId::new(1),
            name: "Crossing the Rubicon".into(),
            kind,
            mime: mime.into(),
            origin: SourceOrigin::Import,
            project_id: None,
            project_name: None,
            size_bytes: 10,
            sha256: [0; 32],
            uri: uri.map(Into::into),
            created_at: 0,
        }
    }

    #[test]
    fn a_web_page_without_an_address_names_no_site() {
        assert_eq!(site(&source(SourceKind::Web, mime::HTML, None)), None);
    }
}
