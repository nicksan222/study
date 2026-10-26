//! PNG encoding of pages, for sending them to a provider.

use image::ImageEncoder as _;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};

use super::PageImage;

/// Losslessly encodes a page for upload. Text compresses well as PNG, and JPEG artifacts
/// around glyphs cost recognition accuracy.
pub fn encode_png(page: &PageImage) -> Vec<u8> {
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            page.rgb().as_raw(),
            page.width(),
            page.height(),
            image::ExtendedColorType::Rgb8,
        )
        // `bitmap.rs` and `pdf.rs` never make a page with a 0-pixel side, the one input the
        // encoder rejects.
        .expect("encoding an in-memory RGB image cannot fail");
    png
}
