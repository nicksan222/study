//! Tidies the whitespace extractors leave behind: line endings made `\n`, invisible
//! characters (byte order marks, zero-width spaces) removed, trailing spaces cut from every
//! line, blank lines trimmed from either end, and blocks left with no text dropped. In
//! prose, runs of blank lines become one and the first line loses its indent; later lines
//! keep theirs, since in Markdown read from pages it nests lists. Code keeps its inner blank
//! lines and every indent.

use study_core::processing::{BoxFuture, Refiner, RefinerKind};
use study_core::{BlockKind, Document, Failure};

/// Tidies each block's whitespace and drops blocks left empty.
pub(super) struct WhitespaceRefiner;

impl Refiner for WhitespaceRefiner {
    fn kind(&self) -> RefinerKind {
        RefinerKind::Whitespace
    }

    fn version(&self) -> u32 {
        2
    }

    fn refine(&self, mut document: Document) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async move {
            for block in &mut document.blocks {
                block.text = tidy(&block.text, block.kind == BlockKind::Code);
            }
            document.blocks.retain(|block| !block.text.is_empty());
            Ok(document)
        })
    }
}

/// Characters that show nothing and only get in the way: byte order marks and zero-width
/// spaces. Zero-width joiners stay: Persian, Indic scripts and emoji need them.
const INVISIBLE: [char; 2] = ['\u{FEFF}', '\u{200B}'];

/// `text` tidied as the module docs say; `code` keeps its inner blank lines and indents.
fn tidy(text: &str, code: bool) -> String {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text: String = text.chars().filter(|c| !INVISIBLE.contains(c)).collect();
    let mut lines: Vec<&str> = Vec::new();
    for line in text.lines().map(str::trim_end) {
        let repeated_blank = line.is_empty() && lines.last().is_none_or(|last| last.is_empty());
        if repeated_blank && (!code || lines.is_empty()) {
            continue;
        }
        lines.push(line);
    }
    while lines.last().is_some_and(|last| last.is_empty()) {
        lines.pop();
    }
    let tidied = lines.join("\n");
    if code {
        tidied
    } else {
        tidied.trim_start().to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::{Anchor, Block};

    fn block(kind: BlockKind, text: &str) -> Block {
        Block {
            kind,
            text: text.into(),
            anchor: Anchor::Page { page: 1 },
        }
    }

    #[tokio::test]
    async fn blocks_are_tidied_and_empty_ones_dropped() {
        let document = Document {
            blocks: vec![
                block(BlockKind::Paragraph, "  First line  \n\n\n\nSecond  \n\n"),
                block(BlockKind::Paragraph, " \n\t\n"),
                block(BlockKind::Code, "\n    indented();  \n"),
            ],
            ..Document::default()
        };
        let refined = WhitespaceRefiner.refine(document).await.unwrap();
        let texts: Vec<_> = refined.blocks.iter().map(|b| b.text.as_str()).collect();
        assert_eq!(texts, ["First line\n\nSecond", "    indented();"]);
    }

    #[test]
    fn line_endings_and_invisible_characters_are_cleaned() {
        assert_eq!(
            tidy("one  \r\n\r\n\r\rtwo\rthree", false),
            "one\n\ntwo\nthree"
        );
        assert_eq!(tidy("\u{FEFF}\u{200B} ", false), "");
        assert_eq!(
            tidy("Title\n  - nested item", false),
            "Title\n  - nested item"
        );
    }

    #[test]
    fn joiners_that_carry_meaning_stay() {
        let persian = "\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}";
        assert_eq!(tidy(persian, false), persian);
        assert_eq!(tidy("👩\u{200D}🔬", false), "👩\u{200D}🔬");
    }

    #[test]
    fn code_keeps_its_blank_lines_and_indents() {
        let code = "\n\nimport os\n\n\ndef main():\n    pass  \n\n";
        assert_eq!(tidy(code, true), "import os\n\n\ndef main():\n    pass");
    }
}
