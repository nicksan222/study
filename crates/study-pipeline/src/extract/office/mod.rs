//! Word-processor documents and slide decks (DOCX, PPTX): their XML read straight from the
//! zip, one block per paragraph (or slide table row), anchored to its paragraph (DOCX) or
//! slide (PPTX).
//!
//! | File         | What it holds                                              |
//! |--------------|------------------------------------------------------------|
//! | `mod.rs`     | [`OfficeExtractor`] and `FORMATS`, a reader per media type |
//! | `docx.rs`    | The DOCX reader: body paragraphs, headings by style        |
//! | `pptx.rs`    | The PPTX reader: slides in order, tables, speaker notes    |
//! | `archive.rs` | Bounded reads of XML parts from the zip, shared by both    |

mod archive;
mod docx;
mod pptx;

use study_core::jobs::off_thread;
use study_core::mime::{DOCX, PPTX};
use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};
use study_core::{Document, ErrorKind, Failure, SourceKind};

/// One format this extractor reads: its kind and media type as sniffed, and its reader.
struct Format {
    kind: SourceKind,
    mime: &'static str,
    read: fn(&[u8]) -> Result<Document, Failure>,
}

/// Every format [`OfficeExtractor`] reads. `extract` goes by this list, so another
/// zip-of-XML format (such as XLSX) is one reader module, one row here, and its media type
/// in the route of its kind.
const FORMATS: [Format; 2] = [
    Format {
        kind: SourceKind::Document,
        mime: DOCX,
        read: docx::read,
    },
    Format {
        kind: SourceKind::Slides,
        mime: PPTX,
        read: pptx::read,
    },
];

/// The format a source is in, if this extractor reads it.
fn format(kind: SourceKind, mime: &str) -> Option<&'static Format> {
    FORMATS
        .iter()
        .find(|format| format.kind == kind && format.mime == mime)
}

/// Reads DOCX and PPTX files.
#[derive(Clone, Copy, Debug, Default)]
pub struct OfficeExtractor;

impl Extractor for OfficeExtractor {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Office
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        let Some(&Format { read, .. }) = format(input.kind, &input.mime) else {
            return Box::pin(async {
                Err(Failure::new(
                    ErrorKind::Unsupported,
                    "not an Office format Study reads",
                ))
            });
        };
        // Unzipped and parsed on the blocking pool, so a large file does not stall the runtime.
        Box::pin(async move { off_thread(move || read(&input.bytes)).await? })
    }
}

/// Builders the DOCX and PPTX tests share.
#[cfg(test)]
mod fixtures {
    use std::io::{Cursor, Write as _};

    use study_core::SourceKind;
    use study_core::processing::SourceInput;

    /// A zip with the given entries.
    pub(super) fn zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut bytes);
        for (name, contents) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(contents.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        bytes.into_inner()
    }

    /// A file of `kind` and `mime` holding `bytes`, as the Extract stage hands it over.
    pub(super) fn input(kind: SourceKind, mime: &str, bytes: Vec<u8>) -> SourceInput {
        SourceInput {
            uri: None,
            name: "file".into(),
            kind,
            mime: mime.into(),
            bytes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::input;
    use super::*;
    use study_core::processing::{Media, ROUTES, route};

    /// The routes send exactly the formats here to this extractor, so the two lists cannot
    /// drift apart.
    #[test]
    fn the_routes_send_exactly_these_formats_here() {
        for format in &FORMATS {
            let route = route(format.kind, format.mime).expect("a route for every format");
            assert!(
                route
                    .extractors
                    .iter()
                    .any(|step| step.kind == ExtractorKind::Office),
                "{} is not routed to the office extractor",
                format.mime
            );
        }
        for route in ROUTES.iter().filter(|route| {
            route
                .extractors
                .iter()
                .any(|s| s.kind == ExtractorKind::Office)
        }) {
            let Media::Only(mimes) = route.media else {
                panic!(
                    "the office route of {:?} must name its media types",
                    route.source
                );
            };
            for mime in mimes {
                assert!(format(route.source, mime).is_some(), "no reader for {mime}");
            }
        }
    }

    #[tokio::test]
    async fn broken_files_are_invalid_input() {
        let failure = OfficeExtractor
            .extract(input(SourceKind::Document, DOCX, b"not a zip".to_vec()))
            .await
            .unwrap_err();
        assert_eq!(failure.kind, ErrorKind::InvalidInput);
    }

    #[tokio::test]
    async fn a_format_without_a_reader_is_unsupported() {
        let failure = OfficeExtractor
            .extract(input(
                SourceKind::Document,
                "application/msword",
                Vec::new(),
            ))
            .await
            .unwrap_err();
        assert_eq!(failure.kind, ErrorKind::Unsupported);
    }
}
