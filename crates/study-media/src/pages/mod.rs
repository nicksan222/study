//! Every image and every PDF page as an 8-bit RGB bitmap no larger than a model accepts.
//!
//! [`Pages::open`] tells a PDF from an image, and [`Pages::page`] hands out one page at a time.
//!
//! To add a paged format (say, DjVu): give it a module beside `pdf.rs` with `page_count` and
//! `render`, a `Format` variant detected in `Format::detect`, and a `Kind` variant; the
//! compiler then points at every match left to extend. To add an image format, see
//! `bitmap.rs`.
//!
//! | File        | What it holds                                                            |
//! |-------------|--------------------------------------------------------------------------|
//! | `mod.rs`    | [`DocumentInput`], [`PageImage`], [`Pages`] and `Format`, the dispatch   |
//! | `bitmap.rs` | Images (PNG, JPEG, WebP, GIF, BMP, TIFF) decoded with `image`            |
//! | `pdf.rs`    | PDF pages rendered with hayro                                            |
//! | `png.rs`    | [`encode_png`], for upload                                               |

mod bitmap;
mod pdf;
mod png;

use std::path::{Path, PathBuf};

use hayro::hayro_syntax::PdfData;
use image::RgbImage;
use image::imageops::FilterType;
use study_core::SourceKind;

use crate::error::{Error, Result};

pub use png::encode_png;

/// Longest PDF accepted, so a stray book-length file cannot occupy the recognizer for days.
const MAX_PAGES: usize = 2_000;

/// Largest page side decoded or rendered, so a crafted file cannot exhaust memory.
const MAX_IMAGE_SIDE: u32 = 16_384;

/// How much of a file on disk is sniffed for its kind.
const SNIFF_BYTES: usize = 8 * 1024;

/// A document to read: an image (PNG, JPEG, WebP, GIF, BMP, TIFF) or a PDF.
#[derive(Clone, Debug)]
pub enum DocumentInput {
    /// A document on disk; it is sniffed by its name and content.
    File(PathBuf),
    /// A document's bytes, such as a stored file.
    Encoded {
        bytes: Vec<u8>,
        /// Its stored kind, a hint for content without a signature.
        kind: Option<SourceKind>,
    },
}

impl From<PathBuf> for DocumentInput {
    fn from(path: PathBuf) -> Self {
        Self::File(path)
    }
}

impl From<&Path> for DocumentInput {
    fn from(path: &Path) -> Self {
        Self::File(path.to_path_buf())
    }
}

/// One page as 8-bit RGB.
#[derive(Clone, Debug, PartialEq)]
pub struct PageImage {
    rgb: RgbImage,
}

impl PageImage {
    /// Wraps an RGB bitmap as a page, as it is.
    pub(crate) fn from_rgb(rgb: RgbImage) -> Self {
        Self { rgb }
    }

    /// The page's pixels.
    pub fn rgb(&self) -> &RgbImage {
        &self.rgb
    }

    /// Width in pixels.
    pub fn width(&self) -> u32 {
        self.rgb.width()
    }

    /// Height in pixels.
    pub fn height(&self) -> u32 {
        self.rgb.height()
    }

    /// Shrinks the image, keeping its aspect ratio, so neither side exceeds `max_side`.
    /// Smaller images are returned unchanged: upscaling adds no detail.
    fn fit_within(self, max_side: u32) -> Self {
        let longest = self.width().max(self.height());
        if longest <= max_side || max_side == 0 {
            return self;
        }
        let scale = f64::from(max_side) / f64::from(longest);
        let width = ((f64::from(self.width()) * scale).round() as u32).max(1);
        let height = ((f64::from(self.height()) * scale).round() as u32).max(1);
        Self {
            rgb: image::imageops::resize(&self.rgb, width, height, FilterType::CatmullRom),
        }
    }
}

/// A decoded input, ready to hand out its pages. PDF pages are rendered on demand so a long
/// document never holds every page in memory at once.
#[derive(Clone)]
pub struct Pages {
    kind: Kind,
}

/// Which reader an input goes to: the one dispatch point for document formats.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Format {
    Pdf,
    /// Anything else; `bitmap.rs` guesses the image format from the content and fails with
    /// [`Error::Decode`] when it isn't one it reads.
    Image,
}

impl Format {
    /// Content wins; the kind is only a hint for content without a signature. A new paged
    /// format adds its signature check here, before the image fallback.
    fn detect(bytes: &[u8], kind: Option<SourceKind>) -> Self {
        let pdf_hint = kind == Some(SourceKind::Pdf) && image::guess_format(bytes).is_err();
        if bytes.starts_with(b"%PDF-") || pdf_hint {
            Self::Pdf
        } else {
            Self::Image
        }
    }
}

/// What was opened, holding what [`Pages::page`] needs. A new document format is one more
/// variant; `page_count` and `page` match on it exhaustively.
#[derive(Clone)]
enum Kind {
    Image(PageImage),
    /// The file's bytes, shared by every clone and every page rendered.
    Pdf {
        bytes: PdfData,
        pages: usize,
    },
}

impl Pages {
    /// Reads and validates an input. CPU-bound: call from a blocking context.
    pub fn open(input: DocumentInput) -> Result<Self> {
        let (bytes, kind) = match input {
            DocumentInput::File(path) => {
                let bytes = std::fs::read(&path)?;
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                let kind = study_core::sniff(&name, &bytes[..bytes.len().min(SNIFF_BYTES)]).kind;
                (bytes, Some(kind))
            }
            DocumentInput::Encoded { bytes, kind } => (bytes, kind),
        };
        let kind = match Format::detect(&bytes, kind) {
            Format::Pdf => {
                let bytes = PdfData::from(bytes);
                let pages = pdf::page_count(&bytes)?;
                if pages == 0 {
                    return Err(Error::EmptyDocument);
                }
                if pages > MAX_PAGES {
                    return Err(Error::TooManyPages {
                        pages,
                        max: MAX_PAGES,
                    });
                }
                Kind::Pdf { bytes, pages }
            }
            Format::Image => Kind::Image(bitmap::decode(bytes)?),
        };
        Ok(Self { kind })
    }

    /// How many pages there are: one for an image.
    pub fn page_count(&self) -> usize {
        match &self.kind {
            Kind::Image(_) => 1,
            Kind::Pdf { pages, .. } => *pages,
        }
    }

    /// The page at `index` (0-based), no larger than `max_side` pixels on either side.
    /// CPU-bound: call from a blocking context.
    pub fn page(&self, index: usize, max_side: u32) -> Result<PageImage> {
        match &self.kind {
            Kind::Image(image) if index == 0 => Ok(image.clone().fit_within(max_side)),
            Kind::Image(_) => Err(Error::Decode(format!("an image has no page {}", index + 1))),
            Kind::Pdf { bytes, .. } => pdf::render(bytes, index, max_side),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgb, Rgba, RgbaImage};

    const PDF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/two_pages.pdf");

    fn encoded(image: DynamicImage, format: ImageFormat) -> DocumentInput {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        DocumentInput::Encoded {
            bytes: bytes.into_inner(),
            kind: None,
        }
    }

    #[test]
    fn an_image_is_one_page_scaled_down_to_the_limit() {
        let wide = DynamicImage::ImageRgb8(RgbImage::new(400, 100));
        let source = Pages::open(encoded(wide, ImageFormat::Png)).unwrap();
        assert_eq!(source.page_count(), 1);
        let page = source.page(0, 200).unwrap();
        assert_eq!((page.width(), page.height()), (200, 50));
        assert!(source.page(1, 200).is_err());
    }

    #[test]
    fn small_images_are_never_upscaled() {
        let page = PageImage::from_rgb(RgbImage::new(30, 20)).fit_within(1000);
        assert_eq!((page.width(), page.height()), (30, 20));
    }

    #[test]
    fn transparency_becomes_white_paper() {
        let clear = RgbaImage::from_pixel(2, 2, Rgba([0, 0, 0, 0]));
        let source =
            Pages::open(encoded(DynamicImage::ImageRgba8(clear), ImageFormat::Png)).unwrap();
        let page = source.page(0, 100).unwrap();
        assert_eq!(*page.rgb().get_pixel(0, 0), Rgb([255, 255, 255]));
    }

    #[test]
    fn pdf_pages_render_on_demand_at_the_requested_size() {
        let source = Pages::open(DocumentInput::File(PDF.into())).unwrap();
        assert_eq!(source.page_count(), 2);
        let page = source.page(1, 792).unwrap();
        assert_eq!((page.width(), page.height()), (612, 792));
        // The page has black text on white.
        let pixels = page.rgb().pixels();
        assert!(pixels.clone().any(|p| p.0 == [255, 255, 255]));
        assert!(pixels.clone().any(|p| p.0[0] < 128));
        assert!(source.page(2, 792).is_err());
    }

    #[test]
    fn pdfs_are_recognised_by_content_as_well_as_by_kind() {
        let bytes = std::fs::read(PDF).unwrap();
        let source = Pages::open(DocumentInput::Encoded { bytes, kind: None }).unwrap();
        assert_eq!(source.page_count(), 2);
    }

    #[test]
    fn content_decides_the_format_and_the_kind_is_a_hint() {
        let (pdf, image) = (Some(SourceKind::Pdf), Some(SourceKind::Image));
        assert_eq!(Format::detect(b"%PDF-1.7", None), Format::Pdf);
        assert_eq!(Format::detect(b"%PDF-1.7", image), Format::Pdf);
        assert_eq!(Format::detect(b"", pdf), Format::Pdf);
        assert_eq!(Format::detect(b"\x89PNG", image), Format::Image);
        assert_eq!(Format::detect(b"\x89PNG\r\n\x1a\n", pdf), Format::Image);
        assert_eq!(Format::detect(b"", None), Format::Image);
    }

    #[test]
    fn unreadable_input_is_a_decode_error() {
        let garbage = DocumentInput::Encoded {
            bytes: vec![1, 2, 3],
            kind: Some(SourceKind::Image),
        };
        assert!(matches!(Pages::open(garbage), Err(Error::Decode(_))));
        let broken_pdf = DocumentInput::Encoded {
            bytes: b"%PDF-1.4 not really".to_vec(),
            kind: None,
        };
        assert!(matches!(Pages::open(broken_pdf), Err(Error::Decode(_))));
    }
}
