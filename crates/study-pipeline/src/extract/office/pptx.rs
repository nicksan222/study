//! The PPTX reader: each slide's paragraphs in the order the deck shows them, its title as a
//! heading, a table one block per row with its cells joined by ` | ` (as web pages and
//! Markdown are read), then its speaker notes as paragraphs. Every block, notes included, is
//! anchored to its slide number. The page count is the slide count.

use std::collections::HashMap;

use study_core::{Anchor, Block, BlockKind, Document, ErrorKind, Failure};

use super::archive::{Archive, MAX_XML_BYTES, finished, open, parse, read_xml, runs};

/// Most slides read from one deck.
const MAX_SLIDES: usize = 2_000;

/// Reads a PPTX.
pub(super) fn read(bytes: &[u8]) -> Result<Document, Failure> {
    let mut archive = open(bytes)?;
    let mut budget = MAX_XML_BYTES;
    let slides = slide_order(&mut archive, &mut budget);
    if slides.len() > MAX_SLIDES {
        return Err(Failure::new(
            ErrorKind::InvalidInput,
            format!("the deck has more than {MAX_SLIDES} slides"),
        ));
    }
    let mut blocks = Vec::new();
    for (position, name) in slides.iter().enumerate() {
        let xml = read_xml(&mut archive, name, &mut budget)?;
        let tree = parse(&xml)?;
        let block = |kind, text| Block {
            kind,
            text,
            anchor: Anchor::Slide {
                index: position as u32 + 1,
            },
        };
        for node in tree.descendants() {
            match node.tag_name().name() {
                "sp" => {
                    let kind = if matches!(placeholder(node), Some("title" | "ctrTitle")) {
                        BlockKind::Heading
                    } else {
                        BlockKind::Paragraph
                    };
                    blocks.extend(paragraphs(node).map(|text| block(kind, text)));
                }
                "tr" if node
                    .parent()
                    .is_some_and(|table| table.tag_name().name() == "tbl") =>
                {
                    blocks.extend(row(node).map(|text| block(BlockKind::Table, text)));
                }
                _ => {}
            }
        }
        // Notes add to a slide, so a deck whose notes cannot be read is still read.
        match notes(&mut archive, name, &mut budget) {
            Ok(notes) => {
                blocks.extend(
                    notes
                        .into_iter()
                        .map(|text| block(BlockKind::Paragraph, text)),
                );
            }
            Err(failure) => tracing::debug!(%failure, slide = name, "speaker notes left out"),
        }
    }
    Ok(finished(blocks, Some(slides.len() as u32)))
}

/// The type of the placeholder a shape fills, such as `title` or `body`, if it fills one.
fn placeholder<'a>(shape: roxmltree::Node<'a, '_>) -> Option<&'a str> {
    shape
        .descendants()
        .find(|node| node.tag_name().name() == "ph")?
        .attribute("type")
}

/// The text of each non-empty paragraph under `node`, trimmed.
fn paragraphs<'a>(node: roxmltree::Node<'a, '_>) -> impl Iterator<Item = String> + 'a {
    node.descendants()
        .filter(|node| node.tag_name().name() == "p")
        .map(|paragraph| runs(paragraph).trim().to_owned())
        .filter(|text| !text.is_empty())
}

/// A table row as its cells' text joined by ` | `; `None` when every cell is empty.
fn row(tr: roxmltree::Node<'_, '_>) -> Option<String> {
    let cells: Vec<String> = tr
        .children()
        .filter(|node| node.tag_name().name() == "tc")
        .map(|cell| paragraphs(cell).collect::<Vec<_>>().join(" "))
        .collect();
    (!cells.iter().all(String::is_empty)).then(|| cells.join(" | "))
}

/// The speaker notes of slide part `slide`: the paragraphs of its notes page's body, found
/// through the slide's relationships. Empty when it has no notes page.
fn notes(archive: &mut Archive<'_>, slide: &str, budget: &mut u64) -> Result<Vec<String>, Failure> {
    let (dir, file) = slide.rsplit_once('/').unwrap_or(("", slide));
    let relationships = format!("{dir}/_rels/{file}.rels");
    if archive.index_for_name(&relationships).is_none() {
        return Ok(Vec::new());
    }
    let relationships = read_xml(archive, &relationships, budget)?;
    let relationships = parse(&relationships)?;
    let Some(target) = relationships
        .descendants()
        .filter(|node| node.tag_name().name() == "Relationship")
        .find(|node| {
            node.attribute("Type")
                .is_some_and(|kind| kind.ends_with("/notesSlide"))
        })
        .and_then(|node| node.attribute("Target"))
    else {
        return Ok(Vec::new());
    };
    let xml = read_xml(archive, &part(dir, target), budget)?;
    let tree = parse(&xml)?;
    Ok(tree
        .descendants()
        .filter(|node| node.tag_name().name() == "sp" && placeholder(*node) == Some("body"))
        .flat_map(paragraphs)
        .collect())
}

/// The part a relationship's `target` names: from the root of the zip when it starts with
/// `/`, otherwise relative to the folder `dir`.
fn part(dir: &str, target: &str) -> String {
    let mut parts: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        dir.split('/').filter(|part| !part.is_empty()).collect()
    };
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            segment => parts.push(segment),
        }
    }
    parts.join("/")
}

/// The slide parts in the order the deck shows them: the order `presentation.xml` lists
/// them in or, without it, file names in number order.
fn slide_order(archive: &mut Archive<'_>, budget: &mut u64) -> Vec<String> {
    listed_order(archive, budget).unwrap_or_else(|failure| {
        tracing::debug!(%failure, "slides in file-name order");
        numbered_order(archive)
    })
}

/// `presentation.xml` lists slide ids, and its relationships say which part each one is.
fn listed_order(archive: &mut Archive<'_>, budget: &mut u64) -> Result<Vec<String>, Failure> {
    let presentation = read_xml(archive, "ppt/presentation.xml", budget)?;
    let relationships = read_xml(archive, "ppt/_rels/presentation.xml.rels", budget)?;
    let relationships = parse(&relationships)?;
    let targets: HashMap<&str, &str> = relationships
        .descendants()
        .filter(|node| node.tag_name().name() == "Relationship")
        .filter_map(|node| Some((node.attribute("Id")?, node.attribute("Target")?)))
        .collect();
    let presentation = parse(&presentation)?;
    let order: Vec<String> = presentation
        .descendants()
        .filter(|node| node.tag_name().name() == "sldId")
        .filter_map(|node| {
            // `r:id`, the relationship naming the part, not the plain numeric `id` beside it.
            let id = node
                .attributes()
                .find(|attribute| attribute.name() == "id" && attribute.namespace().is_some())?
                .value();
            // Targets are relative to `ppt/`, or absolute from the root of the zip.
            let target = targets.get(id)?.trim_start_matches('/');
            Some(format!(
                "ppt/{}",
                target.strip_prefix("ppt/").unwrap_or(target)
            ))
        })
        .collect();
    if order.is_empty() {
        return Err(Failure::new(
            ErrorKind::InvalidInput,
            "presentation.xml lists no slide parts",
        ));
    }
    Ok(order)
}

/// `ppt/slides/slideN.xml` sorted by `N`.
fn numbered_order(archive: &Archive<'_>) -> Vec<String> {
    let mut slides: Vec<(u32, String)> = archive
        .file_names()
        .filter_map(|name| {
            let number = name
                .strip_prefix("ppt/slides/slide")?
                .strip_suffix(".xml")?
                .parse()
                .ok()?;
            Some((number, name.to_owned()))
        })
        .collect();
    slides.sort();
    slides.into_iter().map(|(_, name)| name).collect()
}

#[cfg(test)]
mod tests {
    use study_core::SourceKind;
    use study_core::processing::Extractor;

    use super::super::fixtures::{input, zip};
    use super::super::{OfficeExtractor, PPTX};
    use super::*;

    #[tokio::test]
    async fn a_deck_is_read_slide_by_slide_in_order() {
        let slide = |title: &str, body: &str| {
            format!(
                "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:cSld><p:spTree>\
                 <p:sp><p:nvSpPr><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr>\
                 <p:txBody><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>\
                 <p:sp><p:txBody><a:p><a:r><a:t>{body}</a:t></a:r></a:p></p:txBody></p:sp>\
                 </p:spTree></p:cSld></p:sld>"
            )
        };
        let bytes = zip(&[
            ("ppt/slides/slide10.xml", &slide("Ten", "last")),
            ("ppt/slides/slide2.xml", &slide("Two", "second")),
            ("ppt/slides/slide1.xml", &slide("One", "first")),
        ]);
        let document = OfficeExtractor
            .extract(input(SourceKind::Slides, PPTX, bytes))
            .await
            .unwrap();
        assert_eq!(
            document.text(),
            "One\n\nfirst\n\nTwo\n\nsecond\n\nTen\n\nlast"
        );
        assert_eq!(document.blocks[0].kind, BlockKind::Heading);
        assert_eq!(document.blocks[5].anchor, Anchor::Slide { index: 3 });
        assert_eq!(document.meta.page_count, Some(3));
    }

    #[tokio::test]
    async fn slides_follow_the_order_the_deck_lists() {
        let slide = |text: &str| {
            format!(
                "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t>\
                 </a:r></a:p></p:txBody></p:sp></p:sld>"
            )
        };
        let presentation = "<p:presentation xmlns:p=\"p\" xmlns:r=\"r\"><p:sldIdLst>\
            <p:sldId id=\"256\" r:id=\"rId3\"/><p:sldId id=\"257\" r:id=\"rId2\"/>\
            </p:sldIdLst></p:presentation>";
        let relationships = "<Relationships>\
            <Relationship Id=\"rId2\" Target=\"slides/slide1.xml\"/>\
            <Relationship Id=\"rId3\" Target=\"slides/slide2.xml\"/></Relationships>";
        let bytes = zip(&[
            ("ppt/presentation.xml", presentation),
            ("ppt/_rels/presentation.xml.rels", relationships),
            ("ppt/slides/slide1.xml", &slide("moved second")),
            ("ppt/slides/slide2.xml", &slide("moved first")),
        ]);
        let document = OfficeExtractor
            .extract(input(SourceKind::Slides, PPTX, bytes))
            .await
            .unwrap();
        assert_eq!(document.text(), "moved first\n\nmoved second");
    }

    /// The kind and text of every block, in order.
    fn blocks(document: &Document) -> Vec<(BlockKind, &str)> {
        document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect()
    }

    #[tokio::test]
    async fn a_table_is_read_in_place_one_block_per_row() {
        let cell = |text: &str| {
            format!("<a:tc><a:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></a:txBody></a:tc>")
        };
        let slide = format!(
            "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:cSld><p:spTree>\
             <p:sp><p:txBody><a:p><a:r><a:t>Before</a:t></a:r></a:p></p:txBody></p:sp>\
             <p:graphicFrame><a:graphic><a:graphicData><a:tbl>\
             <a:tr>{}{}</a:tr><a:tr>{}{}</a:tr>\
             </a:tbl></a:graphicData></a:graphic></p:graphicFrame>\
             <p:sp><p:txBody><a:p><a:r><a:t>After</a:t></a:r></a:p></p:txBody></p:sp>\
             </p:spTree></p:cSld></p:sld>",
            cell("Organelle"),
            cell("Job"),
            cell("Mitochondrion"),
            cell("Makes ATP"),
        );
        let bytes = zip(&[("ppt/slides/slide1.xml", &slide)]);
        let document = OfficeExtractor
            .extract(input(SourceKind::Slides, PPTX, bytes))
            .await
            .unwrap();
        assert_eq!(
            blocks(&document),
            [
                (BlockKind::Paragraph, "Before"),
                (BlockKind::Table, "Organelle | Job"),
                (BlockKind::Table, "Mitochondrion | Makes ATP"),
                (BlockKind::Paragraph, "After"),
            ]
        );
        assert_eq!(document.blocks[1].anchor, Anchor::Slide { index: 1 });
    }

    #[tokio::test]
    async fn speaker_notes_follow_their_slide() {
        let slide = "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:sp><p:txBody><a:p><a:r>\
            <a:t>Mitosis</a:t></a:r></a:p></p:txBody></p:sp></p:sld>";
        let relationships = "<Relationships>\
            <Relationship Id=\"rId1\" Type=\"http://x/relationships/slideLayout\" \
             Target=\"../slideLayouts/slideLayout1.xml\"/>\
            <Relationship Id=\"rId2\" Type=\"http://x/relationships/notesSlide\" \
             Target=\"../notesSlides/notesSlide7.xml\"/></Relationships>";
        // Only the body placeholder holds the notes; the slide number beside it does not.
        let notes = "<p:notes xmlns:p=\"p\" xmlns:a=\"a\"><p:cSld><p:spTree>\
            <p:sp><p:nvSpPr><p:nvPr><p:ph type=\"sldNum\"/></p:nvPr></p:nvSpPr>\
             <p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp>\
            <p:sp><p:nvSpPr><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr></p:nvSpPr>\
             <p:txBody><a:p><a:r><a:t>Ask about </a:t></a:r><a:r><a:t>anaphase.</a:t></a:r>\
             </a:p></p:txBody></p:sp>\
            </p:spTree></p:cSld></p:notes>";
        let bytes = zip(&[
            ("ppt/slides/slide1.xml", slide),
            ("ppt/slides/_rels/slide1.xml.rels", relationships),
            ("ppt/notesSlides/notesSlide7.xml", notes),
        ]);
        let document = OfficeExtractor
            .extract(input(SourceKind::Slides, PPTX, bytes))
            .await
            .unwrap();
        assert_eq!(
            blocks(&document),
            [
                (BlockKind::Paragraph, "Mitosis"),
                (BlockKind::Paragraph, "Ask about anaphase."),
            ]
        );
        assert_eq!(document.blocks[1].anchor, Anchor::Slide { index: 1 });
    }

    #[tokio::test]
    async fn a_deck_whose_notes_cannot_be_read_is_still_read() {
        let slide = "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:sp><p:txBody><a:p><a:r>\
            <a:t>Mitosis</a:t></a:r></a:p></p:txBody></p:sp></p:sld>";
        let relationships = "<Relationships><Relationship Id=\"rId2\" \
            Type=\"http://x/relationships/notesSlide\" Target=\"../notesSlides/gone.xml\"/>\
            </Relationships>";
        let bytes = zip(&[
            ("ppt/slides/slide1.xml", slide),
            ("ppt/slides/_rels/slide1.xml.rels", relationships),
        ]);
        let document = OfficeExtractor
            .extract(input(SourceKind::Slides, PPTX, bytes))
            .await
            .unwrap();
        assert_eq!(blocks(&document), [(BlockKind::Paragraph, "Mitosis")]);
    }

    #[test]
    fn a_relationship_target_names_a_part_from_its_folder_or_the_root() {
        let notes = "ppt/notesSlides/n.xml";
        assert_eq!(part("ppt/slides", "../notesSlides/n.xml"), notes);
        assert_eq!(part("ppt/slides", "/ppt/notesSlides/n.xml"), notes);
        assert_eq!(part("ppt", "./notesSlides/n.xml"), notes);
    }

    #[tokio::test]
    async fn slides_fall_back_to_file_name_order_when_the_list_cannot_be_read() {
        let slide = |text: &str| {
            format!(
                "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t>\
                 </a:r></a:p></p:txBody></p:sp></p:sld>"
            )
        };
        // The list says slide 2 comes first, but it is cut off, so it cannot be read.
        let relationships = "<Relationships>\
            <Relationship Id=\"rId2\" Target=\"slides/slide2.xml\"/></Relationships>";
        let bytes = zip(&[
            (
                "ppt/presentation.xml",
                "<p:presentation><p:sldIdLst><p:sldId r:id=\"rId2\"/>",
            ),
            ("ppt/_rels/presentation.xml.rels", relationships),
            ("ppt/slides/slide2.xml", &slide("second")),
            ("ppt/slides/slide1.xml", &slide("first")),
        ]);
        let mut budget = MAX_XML_BYTES;
        assert!(listed_order(&mut open(&bytes).unwrap(), &mut budget).is_err());
        let document = OfficeExtractor
            .extract(input(SourceKind::Slides, PPTX, bytes))
            .await
            .unwrap();
        assert_eq!(document.text(), "first\n\nsecond");
    }
}
