//! PDF pages rasterized in pure Rust with hayro, so no system PDF tools are needed.

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::{Pdf, PdfData};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{RenderCache, RenderSettings, render as render_page};
use image::RgbImage;

use super::{MAX_IMAGE_SIDE, PageImage};
use crate::error::{Error, Result};

/// Renders never go below this scale, so small pages stay legible (1.0 is 72 dpi).
const MIN_SCALE: f32 = 1.0;
/// Nor above it (about 300 dpi), however large the provider's limit.
const MAX_SCALE: f32 = 300.0 / 72.0;

/// Parses the PDF. Each call re-parses, so [`super::Pages`] holds only the bytes, which
/// every parse shares rather than copies.
fn open(bytes: &PdfData) -> Result<Pdf> {
    Pdf::new(bytes.clone()).map_err(|error| Error::Decode(format!("invalid PDF: {error:?}")))
}

/// How many pages the PDF has.
pub(super) fn page_count(bytes: &PdfData) -> Result<usize> {
    Ok(open(bytes)?.pages().len())
}

/// Renders one page on white with its longest side at most `max_side` pixels, at 72 to 300
/// dpi, and never more than `MAX_IMAGE_SIDE` pixels.
pub(super) fn render(bytes: &PdfData, index: usize, max_side: u32) -> Result<PageImage> {
    let pdf = open(bytes)?;
    let page = pdf
        .pages()
        .get(index)
        .ok_or_else(|| Error::Decode(format!("the PDF has no page {}", index + 1)))?;
    let (width, height) = page.render_dimensions();
    let longest = width.max(height);
    if !longest.is_finite() || longest <= 0.0 {
        return Err(Error::Decode(format!("page {} has no size", index + 1)));
    }
    // The cap beats `MIN_SCALE`, so a huge page cannot exhaust memory.
    let scale = (max_side as f32 / longest)
        .clamp(MIN_SCALE, MAX_SCALE)
        .min(MAX_IMAGE_SIDE as f32 / longest);
    let settings = RenderSettings {
        x_scale: scale,
        y_scale: scale,
        bg_color: WHITE,
        ..RenderSettings::default()
    };
    let pixmap = render_page(
        page,
        &RenderCache::new(),
        &InterpreterSettings::default(),
        &settings,
    );
    let (width, height) = (u32::from(pixmap.width()), u32::from(pixmap.height()));
    // The background is opaque, so premultiplied RGBA is plain RGBA here.
    let rgb = pixmap
        .data_as_u8_slice()
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|&[r, g, b, _]| [r, g, b])
        .collect();
    // A side under a pixel floors to 0; pages are never empty, so `encode_png` cannot fail.
    let rgb = RgbImage::from_raw(width, height, rgb)
        .filter(|rgb| rgb.width() > 0 && rgb.height() > 0)
        .ok_or_else(|| Error::Decode(format!("page {} rendered empty", index + 1)))?;
    // `MIN_SCALE` may have rendered a small page past `max_side`.
    Ok(PageImage::from_rgb(rgb).fit_within(max_side))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PDF of one `width` by `height` point page, without an xref table; hayro rebuilds it.
    fn one_page(width: u32, height: u32) -> PdfData {
        PdfData::from(
            format!(
                "%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] >> endobj
trailer << /Root 1 0 R >>
%%EOF"
            )
            .into_bytes(),
        )
    }

    #[test]
    fn a_huge_page_renders_no_larger_than_the_largest_image() {
        let page = render(&one_page(100_000, 10), 0, u32::MAX).unwrap();
        assert!(page.width() <= MAX_IMAGE_SIDE, "{}", page.width());
        assert!(page.height() <= 2, "{}", page.height());
    }

    #[test]
    fn a_page_that_renders_less_than_a_pixel_high_is_a_decode_error() {
        let page = render(&one_page(100_000, 5), 0, u32::MAX);
        assert!(matches!(page, Err(Error::Decode(_))), "{page:?}");
    }
}
