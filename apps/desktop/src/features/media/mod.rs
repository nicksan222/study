//! Library files as the UI shows them: previews, a file's one-line summary, writing an
//! original out for the system viewer, and saving pasted images.

mod kind;
mod pasted;
mod preview;

pub use kind::KindStyle;
pub use pasted::PastedImages;
pub use preview::{MediaPreview, Original, site, site_of_address};

use preview::{materialize_original, prepare_preview};
use std::path::Path;
use study_app::App;
use study_app::views::Source;
use study_core::{ErrorKind, SourceId};
use study_localization::{Locale, joined, media_size};

/// What a session shows of an attached file: its size and, when it can be drawn, a preview.
#[derive(Clone, Debug)]
pub struct AttachmentInfo {
    pub size_bytes: i64,
    pub preview: MediaPreview,
}

/// Reads an attached file's size and builds its preview. `None` when it is no longer in the
/// Library.
pub fn prepare_attachment(
    app: &App,
    source_id: SourceId,
) -> study_core::Result<Option<AttachmentInfo>> {
    let Some(item) = app.source(source_id)? else {
        return Ok(None);
    };
    Ok(Some(attachment_info(app, &item)))
}

/// A file's size and preview, from the source at hand.
pub fn attachment_info(app: &App, item: &Source) -> AttachmentInfo {
    AttachmentInfo {
        size_bytes: item.size_bytes,
        preview: preview_of(app, item),
    }
}

/// Whether a preview of `shown` still shows `now`: the same source, with the same kind and
/// contents. A link its Fetch job brought in changes both; a project renamed changes neither.
pub fn same_preview(shown: &Source, now: &Source) -> bool {
    shown.id == now.id && shown.kind == now.kind && shown.sha256 == now.sha256
}

/// A file's preview, or `Unavailable` when it cannot be built: the failure is logged, and
/// the file shows without one.
pub fn preview_of(app: &App, item: &Source) -> MediaPreview {
    prepare_preview(app, item).unwrap_or_else(|error| {
        crate::features::errors::report(&error);
        MediaPreview::Unavailable
    })
}

/// A short line about a file: its extension and, when known, its size.
pub fn file_summary(name: &str, size_bytes: Option<i64>, locale: Locale) -> String {
    let mut parts = Vec::new();
    if let Some(badge) = badge(name) {
        parts.push(badge);
    }
    if let Some(size) = size_bytes.filter(|size| *size > 0) {
        parts.push(media_size(locale, size));
    }
    joined(&parts)
}

/// The upper-case extension, such as `MP3`, for a badge.
fn badge(name: &str) -> Option<String> {
    plain_extension(name).map(str::to_ascii_uppercase)
}

/// The extension of `name` when it is short and plain enough to show on a badge: up to ten
/// ASCII letters and digits.
fn plain_extension(name: &str) -> Option<&str> {
    let extension = Path::new(name).extension()?.to_str()?;
    (1..=10)
        .contains(&extension.len())
        .then_some(extension)
        .filter(|extension| extension.bytes().all(|byte| byte.is_ascii_alphanumeric()))
}

/// Writes an attached file out for the system viewer.
pub fn original_of(app: &App, source_id: SourceId) -> study_core::Result<Original> {
    let item = app.source(source_id)?.ok_or_else(|| {
        study_core::err!(
            ErrorKind::NotFound,
            "file {source_id} is no longer in the Library"
        )
    })?;
    materialize_original(app, &item)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TempApp;

    /// The seed's sample files are real, so every kind of attachment has something to show.
    #[test]
    fn seeded_attachments_get_previews_that_fit_their_kind() -> study_core::Result<()> {
        let app = TempApp::new();
        assert!(app.seed_demo()?);
        let preview = |name: &str| -> study_core::Result<AttachmentInfo> {
            let item = app
                .sources()?
                .into_iter()
                .find(|item| item.name == name)
                .expect("seeded file");
            Ok(prepare_attachment(&app, item.id)?.expect("still in the Library"))
        };

        let picture = preview("seminar-notes-scan.png")?;
        assert!(picture.size_bytes > 0);
        assert!(matches!(picture.preview, MediaPreview::Image { .. }));
        // A picture is recognised by its bytes, whatever its name says.
        assert!(matches!(
            preview("whiteboard-photo.jpg")?.preview,
            MediaPreview::Image { .. }
        ));
        assert!(matches!(
            preview("grades.csv")?.preview,
            MediaPreview::Text(text) if text.contains("Eigenvalues")
        ));
        // Audio has no picture to show; it is drawn as a card of its own kind.
        assert!(matches!(
            preview("lecture-07.mp3")?.preview,
            MediaPreview::Unavailable
        ));
        // A PDF shows its first page.
        assert!(matches!(
            preview("slides-mitosis.pdf")?.preview,
            MediaPreview::Image { .. }
        ));
        assert!(prepare_attachment(&app, SourceId::new(i64::MAX))?.is_none());
        let gone = original_of(&app, SourceId::new(i64::MAX)).expect_err("not in the Library");
        assert_eq!(gone.kind(), ErrorKind::NotFound);
        Ok(())
    }

    #[test]
    fn a_file_is_summed_up_by_its_extension_and_size() {
        assert_eq!(
            file_summary("a.mp3", Some(2048), Locale::English),
            "MP3 · 2.0 KiB"
        );
    }

    #[test]
    fn badges_show_short_extensions() {
        assert_eq!(badge("a.tar").as_deref(), Some("TAR"));
        assert_eq!(badge("noextension"), None);
        assert_eq!(badge("lesson.sh;rm"), None);
        assert_eq!(badge("lesson.verylongextension"), None);
    }
}
