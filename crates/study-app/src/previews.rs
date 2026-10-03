//! Bounded previews of stored sources: a picture for images and PDFs, the start of the text
//! for text files. Markup such as a saved web page has no text preview: its source isn't
//! something to read. Rendering is pure Rust, so no system tools are needed.

use study_core::Result;
use study_core::db::Source;
use study_core::{SourceKind, is_raster};
use study_media::pages::{DocumentInput, Pages, encode_png};

use crate::App;

/// Largest source rendered as a picture; bigger ones are not previewed.
const MAX_PICTURE_SOURCE_BYTES: usize = 32 * 1024 * 1024;
/// Longest side of a rendered picture, in pixels.
const PICTURE_SIDE: u32 = 1_280;
/// Most text read for a preview.
const MAX_TEXT_BYTES: usize = 32 * 1024;

/// What can be shown of a source without opening it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Preview {
    /// A PNG of the image, or of a PDF's first page, at most 1280 pixels on a side.
    Picture(Vec<u8>),
    /// The start of the text, ending in `…` when there is more.
    Text(String),
    /// Nothing to show: audio, archives, or a file too large or unreadable to render.
    Unavailable,
}

/// What a preview of a source draws, before anything is read.
#[derive(Clone, Copy)]
enum Shown {
    Picture,
    Text,
}

impl Shown {
    /// What a source of `kind`, stored as `mime`, previews as; `None` when it has no preview.
    /// Without a `mime`, the kind alone decides, so any image counts.
    fn of(kind: SourceKind, mime: Option<&str>) -> Option<Self> {
        let raster = mime.is_none_or(is_raster);
        let markup = mime == Some(study_core::mime::HTML);
        let text_mime = mime.is_some_and(|mime| mime.starts_with("text/"));
        match kind {
            SourceKind::Pdf => Some(Self::Picture),
            SourceKind::Image if raster => Some(Self::Picture),
            _ if markup => None,
            SourceKind::Text | SourceKind::Code => Some(Self::Text),
            _ if text_mime => Some(Self::Text),
            _ => None,
        }
    }
}

/// Whether [`App::preview`] can draw something for a source of `kind`, stored as `mime`.
/// Without a `mime`, the kind alone decides, so any image counts.
pub fn has_preview(kind: SourceKind, mime: Option<&str>) -> bool {
    Shown::of(kind, mime).is_some()
}

impl App {
    /// A bounded preview of `source`. Blocks while it reads and renders.
    pub fn preview(&self, source: &Source) -> Result<Preview> {
        match Shown::of(source.kind, Some(&source.mime)) {
            Some(Shown::Picture) => self.picture_preview(source),
            Some(Shown::Text) => self.text_preview(source),
            None => Ok(Preview::Unavailable),
        }
    }

    /// The first page or the image, rendered; nothing when the source is too large to read.
    fn picture_preview(&self, source: &Source) -> Result<Preview> {
        let fits =
            usize::try_from(source.size_bytes).is_ok_and(|size| size <= MAX_PICTURE_SOURCE_BYTES);
        if !fits {
            return Ok(Preview::Unavailable);
        }
        let Some(bytes) = self
            .with(|database| database.read_source_bounded(source.id, MAX_PICTURE_SOURCE_BYTES))?
        else {
            return Ok(Preview::Unavailable);
        };
        Ok(render_first_page(bytes, source.kind).map_or(Preview::Unavailable, Preview::Picture))
    }

    /// The start of the text, marked when there is more.
    fn text_preview(&self, source: &Source) -> Result<Preview> {
        let mut bytes =
            self.with(|database| database.read_source_prefix(source.id, MAX_TEXT_BYTES))?;
        let cut = usize::try_from(source.size_bytes).is_ok_and(|size| size > bytes.len());
        if cut
            && let Err(error) = std::str::from_utf8(&bytes)
            && error.error_len().is_none()
        {
            // The cut split a character: drop its first bytes rather than show them as `�`.
            bytes.truncate(error.valid_up_to());
        }
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if cut {
            text.push('…');
        }
        Ok(Preview::Text(text))
    }
}

/// The first page as PNG; `None` when the bytes cannot be decoded, which a preview shows
/// as nothing rather than as an error.
fn render_first_page(bytes: Vec<u8>, kind: SourceKind) -> Option<Vec<u8>> {
    let pages = Pages::open(DocumentInput::Encoded {
        bytes,
        kind: Some(kind),
    })
    .inspect_err(|error| tracing::debug!(%error, "no preview"))
    .ok()?;
    let page = pages.page(0, PICTURE_SIDE).ok()?;
    Some(encode_png(&page))
}

#[cfg(test)]
mod tests {
    use super::has_preview;
    use study_core::{SourceKind, mime};

    #[test]
    fn markup_has_no_text_preview() {
        assert!(!has_preview(SourceKind::Web, Some(mime::HTML)));
        assert!(!has_preview(SourceKind::Code, Some(mime::HTML)));
        assert!(has_preview(SourceKind::Text, Some(mime::MARKDOWN)));
        assert!(has_preview(SourceKind::Code, Some("text/x-rust")));
    }
}
