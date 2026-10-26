//! Web pages: the readable text of saved HTML, one block per heading, paragraph, list item,
//! quote or table row, anchored to the page and the section it sits under. Navigation,
//! headers, footers, scripts and forms are left out. The bytes are decoded by their byte
//! order mark, else the charset a `<meta>` declares near the top, else as UTF-8.

use std::borrow::Cow;

use encoding_rs::{Encoding, UTF_8};
use scraper::{ElementRef, Html};
use study_core::jobs::off_thread;
use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};
use study_core::text::collapse_whitespace;
use study_core::{Anchor, Block, BlockKind, Document, Failure};

/// Headings: each starts a section, anchored by its id when it has one.
const HEADINGS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];
/// The other blocks of text. A block inside one of these is read with it.
const CONTAINERS: [&str; 8] = [
    "p",
    "li",
    "pre",
    "blockquote",
    "tr",
    "figcaption",
    "dd",
    "dt",
];
/// Elements that separate the text on either side of them, read as a space: line breaks
/// and blocks.
const BREAKS: [&str; 29] = [
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "td",
    "th",
    "tr",
    "ul",
];
/// The parts of a MathML formula that are not read: other notations of it, such as TeX.
const ANNOTATIONS: [&str; 2] = ["annotation", "annotation-xml"];
/// How far into the page a `<meta>` charset is looked for, as browsers do.
const CHARSET_SCAN: usize = 1024;
/// Parts of a page that are not its content.
const CHROME: [&str; 9] = [
    "nav", "header", "footer", "aside", "script", "style", "noscript", "form", "template",
];

/// Reads saved web pages.
#[derive(Clone, Copy, Debug, Default)]
pub struct WebExtractor;

impl Extractor for WebExtractor {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Web
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        // Parsed on the blocking pool, so a large page does not stall the runtime.
        Box::pin(async move { off_thread(move || read_page(&input)).await })
    }
}

/// The page's blocks in reading order, each under the last heading with an id before it.
fn read_page(input: &SourceInput) -> Document {
    let page = Html::parse_document(&decode(&input.bytes));
    let url = input.uri.clone().unwrap_or_else(|| input.name.clone());
    let mut blocks = Vec::new();
    let mut section: Option<String> = None;
    for element in page
        .root_element()
        .descendants()
        .filter_map(ElementRef::wrap)
    {
        let tag = element.value().name();
        let heading = HEADINGS.contains(&tag);
        let wanted = heading || CONTAINERS.contains(&tag);
        if !wanted || inside(element, &CHROME) || inside(element, &CONTAINERS) {
            continue;
        }
        if heading {
            section = element.value().id().map(str::to_owned).or(section);
        }
        let text = match tag {
            "pre" => text_nodes(element)
                .collect::<String>()
                .trim_end()
                .to_owned(),
            "tr" => row(element),
            _ => words(element),
        };
        if text.trim().is_empty() {
            continue;
        }
        blocks.push(Block {
            kind: match tag {
                _ if heading => BlockKind::Heading,
                "li" | "dd" | "dt" => BlockKind::ListItem,
                "pre" => BlockKind::Code,
                "tr" => BlockKind::Table,
                _ => BlockKind::Paragraph,
            },
            text,
            anchor: Anchor::Url {
                url: url.clone(),
                fragment: section.clone(),
            },
        });
    }
    // A page of scripts only was read; there was just no text in it.
    Document {
        blocks,
        ..Document::default()
    }
}

/// The page's text: decoded by its byte order mark, else by the charset a `<meta>` in its
/// first [`CHARSET_SCAN`] bytes declares, else as UTF-8.
pub(crate) fn decode(bytes: &[u8]) -> Cow<'_, str> {
    let declared = declared_charset(&bytes[..bytes.len().min(CHARSET_SCAN)]);
    // A byte order mark overrides the encoding passed here, and is dropped.
    declared.unwrap_or(UTF_8).decode(bytes).0
}

/// The encoding a `<meta>` tag in `head` names, as `charset=…` on its own or inside
/// `content="text/html; charset=…"`.
fn declared_charset(head: &[u8]) -> Option<&'static Encoding> {
    let head = String::from_utf8_lossy(head).to_ascii_lowercase();
    head.split("<meta").skip(1).find_map(|tag| {
        let tag = &tag[..tag.find('>').unwrap_or(tag.len())];
        let value = tag[tag.find("charset")? + "charset".len()..]
            .trim_start()
            .strip_prefix('=')?
            .trim_start()
            .trim_start_matches(['"', '\'']);
        let end = value
            .find(|char: char| char.is_ascii_whitespace() || "\"';/>".contains(char))
            .unwrap_or(value.len());
        charset_encoding(&value[..end])
    })
}

/// The encoding a page's charset `label` names, from its `<meta>` or its headers. A UTF-16
/// label means UTF-8, as the HTML standard has it for a `<meta>`: bytes a label could be
/// read from are never UTF-16 (a real UTF-16 page wins by its byte order mark).
pub(crate) fn charset_encoding(label: &str) -> Option<&'static Encoding> {
    Encoding::for_label(label.as_bytes()).map(Encoding::output_encoding)
}

/// A table row as one line of its cells' words, joined like a Markdown table's; empty when
/// no cell has any.
fn row(element: ElementRef<'_>) -> String {
    let cells: Vec<String> = element
        .children()
        .filter_map(ElementRef::wrap)
        .filter(|cell| matches!(cell.value().name(), "td" | "th"))
        .map(words)
        .collect();
    if cells.iter().all(String::is_empty) {
        return String::new();
    }
    cells.join(" | ")
}

/// The element's text with runs of whitespace collapsed. Text side by side is joined as it
/// is (`H<sub>2</sub>O` reads `H2O`); a line break, or the edge of a block inside it,
/// separates text with a space. A formula's annotations are left out, as in
/// [`text_nodes`].
fn words<'a>(element: ElementRef<'a>) -> String {
    /// What is left to read, last first.
    enum Next<'a> {
        Element(ElementRef<'a>),
        Text(&'a str),
        Space,
    }
    let children = |element: ElementRef<'a>| {
        element
            .children()
            .rev()
            .filter_map(|child| match child.value().as_text() {
                Some(text) => Some(Next::Text(text)),
                None => ElementRef::wrap(child).map(Next::Element),
            })
    };
    let mut text = String::new();
    let mut next: Vec<Next<'a>> = children(element).collect();
    while let Some(step) = next.pop() {
        match step {
            Next::Text(words) => text.push_str(words),
            Next::Space => text.push(' '),
            Next::Element(child) => {
                let name = child.value().name();
                if ANNOTATIONS.contains(&name) {
                    continue;
                }
                if BREAKS.contains(&name) {
                    text.push(' ');
                    next.push(Next::Space);
                }
                next.extend(children(child));
            }
        }
    }
    collapse_whitespace(&text)
}

/// The element's text nodes in order, without a formula's annotations: on pages such as
/// Wikipedia's they hold its TeX source, while the MathML beside them reads as its symbols.
fn text_nodes(element: ElementRef<'_>) -> impl Iterator<Item = &str> {
    element.descendants().filter_map(|node| {
        let text = node.value().as_text()?;
        let annotation = node
            .ancestors()
            .filter_map(ElementRef::wrap)
            .any(|ancestor| ANNOTATIONS.contains(&ancestor.value().name()));
        (!annotation).then_some(&**text)
    })
}

/// Whether any ancestor of `element` is one of `tags`.
fn inside(element: ElementRef<'_>, tags: &[&str]) -> bool {
    element
        .ancestors()
        .filter_map(ElementRef::wrap)
        .any(|ancestor| tags.contains(&ancestor.value().name()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(html: &str) -> SourceInput {
        SourceInput {
            uri: Some("https://example.org/cells".into()),
            name: "Cells".into(),
            kind: study_core::SourceKind::Web,
            mime: study_core::mime::HTML.into(),
            bytes: html.as_bytes().to_vec(),
        }
    }

    #[tokio::test]
    async fn the_content_is_read_by_section_without_the_chrome() {
        let html = "<html><head><title>Cells</title><style>p{}</style></head><body>\
            <nav><a>Home</a><p>Menu</p></nav>\
            <h1>Cells</h1><p>All   living things\n are made of cells.</p>\
            <h2 id=\"organelles\">Organelles</h2>\
            <ul><li><p>Mitochondria</p> make energy</li></ul>\
            <pre>ATP  = energy</pre>\
            <footer><p>© 2026</p></footer><script>track()</script></body></html>";
        let document = WebExtractor.extract(page(html)).await.unwrap();
        let blocks: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect();
        assert_eq!(
            blocks,
            [
                (BlockKind::Heading, "Cells"),
                (BlockKind::Paragraph, "All living things are made of cells."),
                (BlockKind::Heading, "Organelles"),
                (BlockKind::ListItem, "Mitochondria make energy"),
                (BlockKind::Code, "ATP  = energy"),
            ]
        );
        assert_eq!(
            document.blocks[1].anchor,
            Anchor::Url {
                url: "https://example.org/cells".into(),
                fragment: None
            }
        );
        assert_eq!(
            document.blocks[3].anchor,
            Anchor::Url {
                url: "https://example.org/cells".into(),
                fragment: Some("organelles".into())
            }
        );
    }

    fn texts(document: &Document) -> Vec<(BlockKind, &str)> {
        document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect()
    }

    #[tokio::test]
    async fn a_page_is_decoded_in_the_charset_its_meta_declares() {
        let mut input = page("");
        input.bytes = b"<html><head><meta http-equiv=\"Content-Type\" \
            content=\"text/html; charset=windows-1252\"></head>\
            <body><p>Caf\xe9 cr\xe8me</p></body></html>"
            .to_vec();
        let document = WebExtractor.extract(input).await.unwrap();
        assert_eq!(texts(&document), [(BlockKind::Paragraph, "Café crème")]);

        let mut input = page("");
        input.bytes = b"<meta charset='ISO-8859-1'><p>na\xefve</p>".to_vec();
        let document = WebExtractor.extract(input).await.unwrap();
        assert_eq!(texts(&document), [(BlockKind::Paragraph, "naïve")]);

        // Bytes a `<meta>` could be read from are never UTF-16, whatever it says.
        let document = WebExtractor
            .extract(page("<meta charset=\"utf-16\"><p>Café</p>"))
            .await
            .unwrap();
        assert_eq!(texts(&document), [(BlockKind::Paragraph, "Café")]);
    }

    #[tokio::test]
    async fn a_byte_order_mark_wins_over_the_meta() {
        let html = "<meta charset=\"windows-1252\"><p>Café</p>";
        let mut input = page("");
        input.bytes = [0xff, 0xfe]
            .into_iter()
            .chain(html.encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        let document = WebExtractor.extract(input).await.unwrap();
        assert_eq!(texts(&document), [(BlockKind::Paragraph, "Café")]);
    }

    #[tokio::test]
    async fn a_table_row_is_one_block_of_its_cells() {
        let html = "<table><tr><th>a</th><th>b</th></tr>\
            <tr><td>c</td><td><p>d</p>  e</td></tr></table>";
        let document = WebExtractor.extract(page(html)).await.unwrap();
        assert_eq!(
            texts(&document),
            [(BlockKind::Table, "a | b"), (BlockKind::Table, "c | d e")]
        );
    }

    #[tokio::test]
    async fn math_is_read_as_its_symbols_not_its_tex() {
        // Trimmed from a Wikipedia article: MathML whose annotation (and the fallback
        // image's alt) is the TeX source.
        let html = r#"<p>A vector <span class="mwe-math-element"><span
            class="mwe-math-mathml-inline mwe-math-mathml-a11y" style="display: none;"><math
            xmlns="http://www.w3.org/1998/Math/MathML" alttext="{\displaystyle \mathbf {v} }">
            <semantics><mrow class="MJX-TeXAtom-ORD"><mstyle displaystyle="true"
            scriptlevel="0"><mrow class="MJX-TeXAtom-ORD"><mi mathvariant="bold">v</mi></mrow>
            </mstyle></mrow><annotation encoding="application/x-tex">{\displaystyle \mathbf {v} }
            </annotation></semantics></math></span><img
            src="https://wikimedia.org/api/rest_v1/media/math/render/svg/e8" aria-hidden="true"
            class="mwe-math-fallback-image-inline" alt="{\displaystyle \mathbf {v} }"></span>
            has a length.</p>
            <table><tr><td><math><semantics><mi>x</mi><annotation-xml encoding="MathML-Content">
            <ci>tex-x</ci></annotation-xml></semantics></math></td><td>y</td></tr></table>"#;
        let document = WebExtractor.extract(page(html)).await.unwrap();
        assert_eq!(
            texts(&document),
            [
                (BlockKind::Paragraph, "A vector v has a length."),
                (BlockKind::Table, "x | y"),
            ]
        );
    }

    #[tokio::test]
    async fn inline_markup_joins_its_text_and_blocks_and_line_breaks_space_it() {
        let html = "<p>H<sub>2</sub>O</p><p><i>x</i><sup>2</sup> + <b>Hel</b>lo</p>\
            <ul><li><p>one</p><p>two</p></li></ul><p>first<br>second</p>";
        let document = WebExtractor.extract(page(html)).await.unwrap();
        assert_eq!(
            texts(&document),
            [
                (BlockKind::Paragraph, "H2O"),
                (BlockKind::Paragraph, "x2 + Hello"),
                (BlockKind::ListItem, "one two"),
                (BlockKind::Paragraph, "first second"),
            ]
        );
    }

    #[tokio::test]
    async fn a_page_without_text_is_read_as_empty() {
        let document = WebExtractor
            .extract(page("<html><body><script>app()</script></body></html>"))
            .await
            .unwrap();
        assert!(document.is_empty());
    }
}
