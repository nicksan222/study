//! Previews of stored sources as the UI draws them, and writing an original out for the
//! system viewer to open. What a preview contains is decided by `App::preview`.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use study_app::views::Source;
use study_app::{App, Preview};
use study_core::{Context as _, ErrorKind, Result, bail};

use tempfile::TempDir;

/// What the UI draws for a source.
#[derive(Clone, Debug)]
pub enum MediaPreview {
    /// A picture, written out for GPUI to load. The file lives as long as `_directory`.
    Image {
        path: PathBuf,
        _directory: Arc<TempDir>,
    },
    /// The start of a text file.
    Text(String),
    /// Nothing to draw; the source is shown by its kind.
    Unavailable,
}

/// A source's preview, with its picture written to a private temporary file for the UI to
/// load.
pub fn prepare_preview(app: &App, item: &Source) -> Result<MediaPreview> {
    Ok(match app.preview(item)? {
        Preview::Picture(png) => {
            let directory =
                Arc::new(tempfile::tempdir().context("cannot create preview directory")?);
            let path = directory.path().join("preview.png");
            std::fs::write(&path, png).context("cannot save the preview")?;
            MediaPreview::Image {
                path,
                _directory: directory,
            }
        }
        Preview::Text(text) => MediaPreview::Text(text),
        Preview::Unavailable => MediaPreview::Unavailable,
    })
}

/// A source's original written out to a private temporary directory, for the system viewer
/// to open. The copy lives as long as this does.
#[derive(Debug)]
pub struct Original {
    path: PathBuf,
    _directory: TempDir,
}

impl Original {
    /// Where the copy is.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Streams the full original into a private temporary directory, for the system viewer to
/// open when asked.
///
/// The fixed basename, and an extension chosen from the sniffed kind rather than the name, keep
/// an imported name from choosing the path or what the system does with it.
pub(super) fn materialize_original(app: &App, item: &Source) -> Result<Original> {
    let Some(extension) = study_core::source_kind::viewer_extension(item.kind, &item.mime) else {
        bail!(
            ErrorKind::Unsupported,
            "this kind of file cannot be opened with the system viewer"
        );
    };
    let directory = tempfile::tempdir().context("cannot create media temp directory")?;
    let path = directory.path().join(format!("original.{extension}"));
    let mut output = std::fs::File::create(&path).context("cannot create temporary media file")?;
    app.export_source(item.id, &mut output)?;
    output
        .sync_all()
        .context("cannot finish temporary media file")?;
    Ok(Original {
        path,
        _directory: directory,
    })
}

/// The site `text` names when it is a web address (it has a scheme, such as `https://`);
/// `None` for anything else, such as a file name.
pub fn site_of_address(text: &str) -> Option<String> {
    text.contains("://").then(|| site(text)).flatten()
}

/// The site a web address points at, such as `en.wikipedia.org`, without its `www.`, sign-in
/// or port.
pub fn site(uri: &str) -> Option<String> {
    let rest = uri.split_once("://").map_or(uri, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let host = match authority.rsplit_once(':') {
        Some((host, port)) if port.bytes().all(|byte| byte.is_ascii_digit()) => host,
        _ => authority,
    }
    .trim_start_matches("www.");
    (!host.is_empty()).then(|| host.to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_web_address_names_its_site() {
        assert_eq!(
            super::site("https://en.wikipedia.org/wiki/Rubicon").as_deref(),
            Some("en.wikipedia.org")
        );
        assert_eq!(
            super::site("http://www.example.com?q=1").as_deref(),
            Some("example.com")
        );
        assert_eq!(super::site(""), None);
        assert_eq!(
            super::site_of_address("https://openstax.org/books").as_deref(),
            Some("openstax.org")
        );
        assert_eq!(super::site_of_address("lecture-07.mp3"), None);
    }

    #[test]
    fn a_site_leaves_out_the_sign_in_and_the_port() {
        assert_eq!(
            super::site("https://user:pw@host:8080/x").as_deref(),
            Some("host")
        );
        assert_eq!(super::site("http://host:80").as_deref(), Some("host"));
    }

    use super::*;
    use crate::testing::TempApp;
    use image::{Rgba, RgbaImage};
    use std::fs;
    use study_core::SourceKind;

    #[test]
    fn previews_actual_image_and_bounded_text_from_storage() -> Result<()> {
        let app = TempApp::new();

        let image_path = app.dir().join("diagram.png");
        RgbaImage::from_pixel(12, 8, Rgba([20, 40, 60, 255])).save(&image_path)?;
        let image_item = app.import_file(&image_path, None)?;
        let preview = prepare_preview(&app, &image_item)?;
        let MediaPreview::Image {
            path,
            _directory: directory,
        } = preview
        else {
            panic!("expected image preview");
        };
        assert!(path.starts_with(directory.path()));
        assert_eq!(image::image_dimensions(path)?, (12, 8));

        let text_path = app.dir().join("notes.md");
        let text = "a".repeat(32 * 1024 + 10);
        fs::write(&text_path, &text)?;
        let text_item = app.import_file(&text_path, None)?;
        let MediaPreview::Text(preview) = prepare_preview(&app, &text_item)? else {
            panic!("expected text preview");
        };
        assert_eq!(preview.chars().count(), 32 * 1024 + 1);
        assert!(preview.ends_with('…'));
        Ok(())
    }

    #[test]
    fn original_materialization_round_trips_bytes_with_a_safe_name() -> Result<()> {
        let app = TempApp::new();
        let source = app.dir().join("lesson.PDF");
        let bytes = b"stored lesson";
        fs::write(&source, bytes)?;
        let mut item = app.import_file(&source, None)?;
        item.name = "../../unsafe.PDF".into();

        let original = materialize_original(&app, &item)?;
        let path = original.path().to_owned();
        assert_eq!(path.file_name(), Some("original.pdf".as_ref()));
        assert_eq!(fs::read(&path)?, bytes);
        // The copy goes with the value that owns it.
        drop(original);
        assert!(!path.exists());
        Ok(())
    }

    #[test]
    fn unsupported_and_oversized_images_are_not_materialized_for_preview() -> Result<()> {
        let app = TempApp::new();
        let source = app.dir().join("archive.bin");
        fs::write(&source, [0, 159, 146, 150])?;
        let mut item = app.import_file(&source, None)?;
        assert_eq!(item.kind, SourceKind::Other);
        assert!(matches!(
            prepare_preview(&app, &item)?,
            MediaPreview::Unavailable
        ));

        item.kind = SourceKind::Image;
        item.mime = "image/png".into();
        item.size_bytes = 32 * 1024 * 1024 + 1;
        assert!(matches!(
            prepare_preview(&app, &item)?,
            MediaPreview::Unavailable
        ));
        Ok(())
    }

    #[test]
    fn large_text_media_still_gets_a_bounded_prefix_preview() -> Result<()> {
        let app = TempApp::new();
        let source = app.dir().join("notes.txt");
        fs::write(&source, b"A short prefix")?;
        let mut item = app.import_file(&source, None)?;
        item.size_bytes = 32 * 1024 * 1024 + 1;

        let MediaPreview::Text(preview) = prepare_preview(&app, &item)? else {
            panic!("expected text preview");
        };
        assert_eq!(preview, "A short prefix…");
        Ok(())
    }

    #[test]
    fn originals_open_only_under_an_extension_their_kind_allows() -> Result<()> {
        let app = TempApp::new();
        let import = |name: &str, bytes: &[u8]| -> Result<Source> {
            let source = app.dir().join(name);
            fs::write(&source, bytes)?;
            app.import_file(&source, None)
        };
        let extension = |item: &Source| -> Result<Option<String>> {
            Ok(match materialize_original(&app, item) {
                Ok(original) => Some(
                    original
                        .path()
                        .extension()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                ),
                Err(error) if error.kind() == ErrorKind::Unsupported => None,
                Err(error) => return Err(error),
            })
        };

        // Programs and scripts never keep an extension the system would run.
        let program = import("program.exe", b"MZ\x90\0\x03\0\0\0")?;
        assert_eq!(extension(&program)?, None);
        let text = import("program.exe", b"not really an executable")?;
        assert_eq!(extension(&text)?.as_deref(), Some("txt"));
        let script = import("install.sh", b"#!/bin/sh\necho hi\n")?;
        assert_eq!(extension(&script)?.as_deref(), Some("txt"));
        let page = import("page.html", b"<script>alert(1)</script>")?;
        assert_eq!(extension(&page)?.as_deref(), Some("txt"));

        // Kinds the viewer must not open are refused.
        let drawing = import(
            "drawing.svg",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
        )?;
        assert_eq!(drawing.kind, SourceKind::Image);
        assert_eq!(extension(&drawing)?, None);
        let archive = import("bundle.zip", b"PK\x03\x04\x14\0\0\0")?;
        assert_eq!(archive.kind, SourceKind::Archive);
        assert_eq!(extension(&archive)?, None);
        let mut web = page;
        web.kind = SourceKind::Web;
        assert_eq!(extension(&web)?, None);
        Ok(())
    }
}
