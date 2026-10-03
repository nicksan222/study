//! Images (PNG, JPEG, WebP, GIF, BMP, TIFF) decoded to an upright RGB page with `image`,
//! which guesses the format from the content.
//!
//! The formats Study promises are `FORMATS` in the tests below. To add one:
//! 1. Enable its `image` feature in this crate's `Cargo.toml`, the one list of formats.
//! 2. Add its media type to `RASTER` in `study-core/src/source_kind.rs`, and its extension
//!    to `EXTENSIONS` there if missing. `RASTER` is the real gate: the desktop build
//!    unifies `image` with every default format, so this module may decode more than Study
//!    routes to it, but only `RASTER` types reach it.
//! 3. Add it to `FORMATS`; the tests check both steps above and decode a sample.

use image::{ImageDecoder as _, ImageReader, RgbImage};

use super::{MAX_IMAGE_SIDE, PageImage};
use crate::error::{Error, Result};

/// The most memory decoding one image may take, so a crafted file cannot exhaust memory.
const MAX_IMAGE_ALLOCATION: u64 = 512 * 1024 * 1024;

/// Decodes an image, upright and flattened onto white.
pub(super) fn decode(bytes: Vec<u8>) -> Result<PageImage> {
    let decode = |error: image::ImageError| Error::Decode(error.to_string());
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    limits.max_alloc = Some(MAX_IMAGE_ALLOCATION);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(decode)?;
    // Phone photos of notes are usually stored sideways with an EXIF rotation.
    let orientation = decoder.orientation().map_err(decode)?;
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(decode)?;
    image.apply_orientation(orientation);
    // A GIF can have a 0-pixel screen; pages are never empty, so `encode_png` cannot fail.
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::EmptyDocument);
    }
    Ok(PageImage::from_rgb(flatten_on_white(image)))
}

/// Transparent areas become white, as on paper, instead of the black that dropping the alpha
/// channel would leave.
fn flatten_on_white(image: image::DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.into_rgb8();
    }
    let rgba = image.into_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let blend =
            |c: u8| ((u16::from(c) * u16::from(a) + 255 * (255 - u16::from(a))) / 255) as u8;
        image::Rgb([blend(r), blend(g), blend(b)])
    })
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, ImageFormat, RgbImage};

    use super::*;

    /// Every image format Study promises to read.
    const FORMATS: [ImageFormat; 6] = [
        ImageFormat::Png,
        ImageFormat::Jpeg,
        ImageFormat::WebP,
        ImageFormat::Gif,
        ImageFormat::Bmp,
        ImageFormat::Tiff,
    ];

    #[test]
    fn every_promised_format_is_enabled_routed_and_decodes() {
        for format in FORMATS {
            assert!(
                format.reading_enabled(),
                "{format:?}: enable its `image` feature"
            );
            assert!(
                study_core::is_raster(format.to_mime_type()),
                "{format:?}: add {} to RASTER in study-core",
                format.to_mime_type()
            );
            let mut bytes = std::io::Cursor::new(Vec::new());
            DynamicImage::ImageRgb8(RgbImage::new(3, 2))
                .write_to(&mut bytes, format)
                .unwrap_or_else(|error| panic!("{format:?}: cannot encode a sample: {error}"));
            let page = decode(bytes.into_inner())
                .unwrap_or_else(|error| panic!("{format:?}: cannot decode: {error}"));
            assert_eq!((page.width(), page.height()), (3, 2), "{format:?}");
        }
    }

    #[test]
    fn a_gif_with_a_zero_wide_screen_is_an_empty_document() {
        let mut gif = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(RgbImage::new(3, 2))
            .write_to(&mut gif, ImageFormat::Gif)
            .unwrap();
        let mut gif = gif.into_inner();
        // The logical screen's width, after the 6-byte signature.
        gif[6..8].fill(0);
        assert!(matches!(decode(gif), Err(Error::EmptyDocument)));
    }
}
