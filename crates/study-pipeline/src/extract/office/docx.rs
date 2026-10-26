//! The DOCX reader: every paragraph of `word/document.xml`, headings by their style and list
//! items by their numbering, each anchored to its paragraph number (empty ones counted).

use study_core::{Anchor, Block, BlockKind, Document, Failure};

use super::archive::{MAX_XML_BYTES, finished, open, parse, read_xml, runs};

/// Reads a DOCX.
pub(super) fn read(bytes: &[u8]) -> Result<Document, Failure> {
    let mut budget = MAX_XML_BYTES;
    let xml = read_xml(&mut open(bytes)?, "word/document.xml", &mut budget)?;
    let tree = parse(&xml)?;
    let mut blocks = Vec::new();
    let paragraphs = tree
        .descendants()
        .filter(|node| node.tag_name().name() == "p");
    for (index, paragraph) in paragraphs.enumerate() {
        let text = runs(paragraph);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        blocks.push(Block {
            kind: kind(paragraph),
            text: text.to_owned(),
            anchor: Anchor::Paragraph {
                index: index as u32 + 1,
            },
        });
    }
    Ok(finished(blocks, None))
}

/// A heading when styled `Heading…` or `Title`, a list item when numbered.
fn kind(paragraph: roxmltree::Node<'_, '_>) -> BlockKind {
    let style = paragraph
        .descendants()
        .find(|node| node.tag_name().name() == "pStyle")
        .and_then(|node| {
            node.attributes()
                .find(|attribute| attribute.name() == "val")
                .map(|attribute| attribute.value())
        })
        .unwrap_or_default();
    let listed = paragraph
        .descendants()
        .any(|node| node.tag_name().name() == "numPr");
    if style.starts_with("Heading") || style == "Title" {
        BlockKind::Heading
    } else if listed {
        BlockKind::ListItem
    } else {
        BlockKind::Paragraph
    }
}

#[cfg(test)]
mod tests {
    use study_core::SourceKind;
    use study_core::processing::Extractor;

    use super::super::fixtures::{input, zip};
    use super::super::{DOCX, OfficeExtractor};
    use super::*;

    const W: &str = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"";

    #[tokio::test]
    async fn a_word_document_becomes_numbered_paragraphs() {
        let xml = format!(
            "<w:document {W}><w:body>\
             <w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Cells</w:t></w:r></w:p>\
             <w:p></w:p>\
             <w:p><w:r><w:t>Mitochondria </w:t></w:r><w:r><w:t>power the cell.</w:t></w:r></w:p>\
             <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Ribosomes</w:t></w:r></w:p>\
             </w:body></w:document>"
        );
        let bytes = zip(&[("word/document.xml", &xml)]);
        let document = OfficeExtractor
            .extract(input(SourceKind::Document, DOCX, bytes))
            .await
            .unwrap();
        let blocks: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str(), block.anchor.clone()))
            .collect();
        assert_eq!(
            blocks,
            [
                (BlockKind::Heading, "Cells", Anchor::Paragraph { index: 1 }),
                (
                    BlockKind::Paragraph,
                    "Mitochondria power the cell.",
                    Anchor::Paragraph { index: 3 }
                ),
                (
                    BlockKind::ListItem,
                    "Ribosomes",
                    Anchor::Paragraph { index: 4 }
                ),
            ]
        );
    }
}
