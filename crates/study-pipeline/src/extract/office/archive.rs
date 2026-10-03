//! Reading XML parts out of an Office zip, within a size budget so a crafted archive cannot
//! exhaust memory, and the small XML helpers both readers share.

use std::io::{Cursor, Read as _};

use study_core::{Block, Document, ErrorKind, Failure};

/// Most XML read from one file, over all its parts.
pub(super) const MAX_XML_BYTES: u64 = 32 * 1024 * 1024;

/// An Office file opened as the zip it is.
pub(super) type Archive<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

/// Opens `bytes` as a zip; anything else is not a valid document.
pub(super) fn open(bytes: &[u8]) -> Result<Archive<'_>, Failure> {
    zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| {
        Failure::new(
            ErrorKind::InvalidInput,
            format!("not a valid document: {error}"),
        )
    })
}

/// Reads one part, counting it against `budget`, the XML still allowed for this file.
pub(super) fn read_xml(
    archive: &mut Archive<'_>,
    name: &str,
    budget: &mut u64,
) -> Result<String, Failure> {
    let entry = archive.by_name(name).map_err(|error| {
        Failure::new(
            ErrorKind::InvalidInput,
            format!("{name} is missing: {error}"),
        )
    })?;
    let mut xml = String::new();
    // One byte past the budget tells a part that overflows it from one that just fits.
    let read = entry
        .take(*budget + 1)
        .read_to_string(&mut xml)
        .map_err(|error| {
            Failure::new(
                ErrorKind::InvalidInput,
                format!("cannot read {name}: {error}"),
            )
        })? as u64;
    if read > *budget {
        return Err(Failure::new(
            ErrorKind::InvalidInput,
            "the document is too large to read",
        ));
    }
    *budget -= read;
    Ok(xml)
}

/// Parses one part's XML.
pub(super) fn parse(xml: &str) -> Result<roxmltree::Document<'_>, Failure> {
    roxmltree::Document::parse(xml)
        .map_err(|error| Failure::new(ErrorKind::InvalidInput, format!("invalid XML: {error}")))
}

/// The text of every `<…:t>` run under `node`, in order.
pub(super) fn runs(node: roxmltree::Node<'_, '_>) -> String {
    node.descendants()
        .filter(|child| child.tag_name().name() == "t")
        .filter_map(|child| child.text())
        .collect()
}

/// The document read; one without text is read too, just empty.
pub(super) fn finished(blocks: Vec<Block>, pages: Option<u32>) -> Document {
    let mut document = Document {
        blocks,
        ..Document::default()
    };
    document.meta.page_count = pages;
    document
}
