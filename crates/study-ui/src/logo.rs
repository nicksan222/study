//! Study's mark: the highlighter-yellow tile with the open book, in full colour. The drawings
//! are the masters in the repository's `assets/logo/`, which the README and the website use
//! too: the full mark from [`FULL_MARK_FROM`] up, and a simplified one, with thicker strokes
//! and no text lines, below it. The tile stays yellow in light and dark alike, because it is
//! the highlighter's own colour.
//!
//! Icons go through [`icon()`](crate::icon()), which draws an SVG as a mask tinted by the
//! text colour; a two-colour drawing can't. The mark is instead rasterised in colour by
//! GPUI's SVG renderer at exactly the device pixels it covers (its size at the current zoom
//! times the window's scale factor), so it stays crisp on any display, and each rasterised
//! size is kept for the next frame.

use std::collections::HashMap;
use std::sync::Arc;

use gpui_kit::{
    App, DevicePixels, Global, ImageSource, Img, RenderImage, Styled as _, SvgSize, img, size,
};

/// Below this design size the simplified drawing reads better than the full one. The
/// website's `Logo.astro` switches at the same size.
const FULL_MARK_FROM: f32 = 40.;

/// Study's mark, `size` design pixels square at the current zoom.
pub fn logo(size: f32, cx: &App) -> Img {
    let side = crate::theme::unit(cx, size);
    let mark = if size < FULL_MARK_FROM {
        Mark::Small
    } else {
        Mark::Full
    };
    img(ImageSource::Custom(Arc::new(move |window, cx| {
        let pixels = (f32::from(side) * window.scale_factor()).ceil() as i32;
        Some(Ok(rasterised(mark, pixels.max(1), cx)?))
    })))
    .size(side)
    .flex_none()
}

/// Which of the two drawings.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Mark {
    Full,
    Small,
}

impl Mark {
    fn svg(self) -> &'static [u8] {
        match self {
            Mark::Full => include_bytes!("../../../assets/logo/study.svg"),
            Mark::Small => include_bytes!("../../../assets/logo/study-small.svg"),
        }
    }
}

/// Every mark rasterised so far, by drawing and side in device pixels.
#[derive(Default)]
struct Rasterised(HashMap<(Mark, i32), Arc<RenderImage>>);

impl Global for Rasterised {}

/// `mark` as an image `pixels` device pixels square, rasterised the first time it's asked
/// for. `None` only if a bundled drawing fails to parse, which a test rules out.
fn rasterised(mark: Mark, pixels: i32, cx: &mut App) -> Option<Arc<RenderImage>> {
    if let Some(image) = cx.default_global::<Rasterised>().0.get(&(mark, pixels)) {
        return Some(image.clone());
    }
    let renderer = cx.svg_renderer();
    let side = size(DevicePixels(pixels), DevicePixels(pixels));
    let image = renderer
        .parse_svg(mark.svg())
        .and_then(|svg| renderer.render_parsed(&svg, SvgSize::ExactSize(side)))
        .ok()?;
    cx.default_global::<Rasterised>()
        .0
        .insert((mark, pixels), image.clone());
    Some(image)
}

#[cfg(test)]
mod tests {
    use super::{Mark, rasterised};
    use gpui_kit::{DevicePixels, TestAppContext, size};

    /// Both drawings rasterise at exactly the asked size, in colour: the tile's edge is the
    /// highlighter yellow, not a tinted mask.
    #[gpui_kit::test]
    fn drawings_rasterise_in_colour(cx: &mut TestAppContext) {
        for mark in [Mark::Full, Mark::Small] {
            let image = cx
                .update(|cx| rasterised(mark, 76, cx))
                .expect("the logo rasterises");
            assert!(image.size(0) == size(DevicePixels(76), DevicePixels(76)));
            let bytes = image.as_bytes(0).expect("one frame");
            // Halfway down the left edge, inside the tile; GPUI stores BGRA.
            let at = (38 * 76 + 2) * 4;
            assert_eq!(&bytes[at..at + 4], &[0x4b, 0xd2, 0xf2, 0xff]);
        }
    }

    /// The installers' icon, `apps/desktop/packaging/icon.png`, is the full mark 448 pixels
    /// square in the middle of 512, the margin macOS expects of an app icon. When the mark
    /// changes this fails and writes the new icon, to copy over the old one.
    #[gpui_kit::test]
    fn the_installers_icon_is_the_mark(cx: &mut TestAppContext) {
        const SIDE: u32 = 512;
        const MARK: u32 = 448;
        let mark = cx
            .update(|cx| rasterised(Mark::Full, MARK as i32, cx))
            .expect("the logo rasterises");
        let bgra = mark.as_bytes(0).expect("one frame");
        let inset = (SIDE - MARK) / 2;
        let mut expected = image::RgbaImage::new(SIDE, SIDE);
        for (index, pixel) in (0..).zip(bgra.as_chunks::<4>().0) {
            let rgba = image::Rgba([pixel[2], pixel[1], pixel[0], pixel[3]]);
            expected.put_pixel(inset + index % MARK, inset + index / MARK, rgba);
        }

        let icon = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/packaging/icon.png");
        let committed = image::open(&icon)
            .expect("the installers' icon is readable")
            .to_rgba8();
        let close = |a: &image::Rgba<u8>, b: &image::Rgba<u8>| {
            a.0.iter().zip(b.0).all(|(a, b)| a.abs_diff(b) <= 2)
        };
        let same = committed.dimensions() == expected.dimensions()
            && committed
                .pixels()
                .zip(expected.pixels())
                .all(|(a, b)| close(a, b));
        if !same {
            let fresh = std::env::temp_dir().join("study-icon.png");
            expected.save(&fresh).expect("the new icon is written");
            panic!(
                "{} is not the mark in assets/logo/study.svg: copy {} over it",
                icon.display(),
                fresh.display()
            );
        }
    }
}
