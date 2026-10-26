//! Plain text, Markdown, code, notes and CSV: split into paragraphs at blank lines (a
//! Markdown code fence stays whole), each anchored to its lines and byte range. No model
//! involved.

use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};
use study_core::{
    Anchor, Block, BlockKind, Document, DocumentMeta, ErrorKind, Failure, SourceKind, mime,
};

use super::markdown_kind;

/// Reads text files as they are: no model involved.
#[derive(Clone, Copy, Debug, Default)]
pub struct TextExtractor;

impl Extractor for TextExtractor {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Text
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async move {
            let text = String::from_utf8(input.bytes).map_err(|_| {
                Failure::new(ErrorKind::InvalidInput, "the file is not readable text")
            })?;
            let markdown = input.mime == mime::MARKDOWN;
            let code = input.kind == SourceKind::Code;
            Ok(Document {
                blocks: paragraphs(&text, markdown, code),
                meta: DocumentMeta::default(),
            })
        })
    }
}

/// A run of lines: 1-based line numbers and byte offsets into the text.
#[derive(Clone, Copy)]
struct Span {
    line_start: u32,
    line_end: u32,
    start: usize,
    end: usize,
}

/// Paragraphs of `text`: runs of non-blank lines. In Markdown, a fenced code block (` ``` `
/// or `~~~`) is one code block, blank lines and all, a line starting with `#` is a heading of
/// its own, and other paragraphs get their [`markdown_kind`]. In code, every paragraph is
/// code.
fn paragraphs(text: &str, markdown: bool, code: bool) -> Vec<Block> {
    let kind = |body: &str| {
        if code {
            BlockKind::Code
        } else if markdown {
            markdown_kind(body)
        } else {
            BlockKind::Paragraph
        }
    };
    let fenced = |_: &str| BlockKind::Code;
    let mut blocks = Vec::new();
    let mut current: Option<Span> = None;
    // The fence of the code block being read: its character and length.
    let mut fence: Option<(char, usize)> = None;
    let mut offset = 0;
    for (index, line) in text.split_inclusive('\n').enumerate() {
        let number = index as u32 + 1;
        let span = Span {
            line_start: number,
            line_end: number,
            start: offset,
            end: offset + line.len(),
        };
        offset = span.end;
        if let Some(open) = fence {
            let run = joined(current.take(), span);
            if closes(line, open) {
                fence = None;
                blocks.push(block(text, run, fenced));
            } else {
                current = Some(run);
            }
            continue;
        }
        if line.trim().is_empty() {
            flush(&mut blocks, text, current.take(), kind);
            continue;
        }
        if markdown && let Some(open) = opens(line) {
            flush(&mut blocks, text, current.take(), kind);
            fence = Some(open);
            current = Some(span);
            continue;
        }
        if markdown && line.starts_with('#') {
            flush(&mut blocks, text, current.take(), kind);
            blocks.push(block(text, span, kind));
            continue;
        }
        current = Some(joined(current, span));
    }
    // A fence left open runs to the end of the text.
    match fence {
        Some(_) => flush(&mut blocks, text, current, fenced),
        None => flush(&mut blocks, text, current, kind),
    }
    blocks
}

/// Ends the run `current`, if there is one, as a block of the kind `kind` gives its text.
fn flush(
    blocks: &mut Vec<Block>,
    text: &str,
    current: Option<Span>,
    kind: impl FnOnce(&str) -> BlockKind,
) {
    blocks.extend(current.map(|span| block(text, span, kind)));
}

/// `span` added to the run `current`, or a run of its own.
fn joined(current: Option<Span>, span: Span) -> Span {
    match current {
        Some(current) => Span {
            line_end: span.line_end,
            end: span.end,
            ..current
        },
        None => span,
    }
}

/// The fence `line` opens a code block with: three or more backticks or tildes. After
/// backticks, a backtick means inline code instead.
fn opens(line: &str) -> Option<(char, usize)> {
    let line = line.trim_start();
    let mark = line
        .chars()
        .next()
        .filter(|mark| matches!(mark, '`' | '~'))?;
    let length = line.chars().take_while(|char| *char == mark).count();
    let inline = mark == '`' && line[length..].contains('`');
    (length >= 3 && !inline).then_some((mark, length))
}

/// Whether `line` closes the code block `open` began: only the same character, at least as
/// many of it.
fn closes(line: &str, (mark, length): (char, usize)) -> bool {
    let line = line.trim();
    line.chars().all(|char| char == mark) && line.chars().count() >= length
}

/// The block for one span, without its trailing whitespace, of the kind `kind` gives its
/// text.
fn block(text: &str, span: Span, kind: impl FnOnce(&str) -> BlockKind) -> Block {
    let body = text[span.start..span.end].trim_end();
    Block {
        kind: kind(body),
        text: body.to_owned(),
        anchor: Anchor::Text {
            line_start: span.line_start,
            line_end: span.line_end,
            start: span.start as u32,
            end: (span.start + body.len()) as u32,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(name: &str, mime: &str, kind: SourceKind, text: &str) -> Document {
        let input = SourceInput {
            uri: None,
            name: name.into(),
            kind,
            mime: mime.into(),
            bytes: text.as_bytes().to_vec(),
        };
        futures::executor::block_on(TextExtractor.extract(input)).unwrap()
    }

    #[test]
    fn paragraphs_keep_their_lines_and_bytes() {
        let document = read(
            "notes.txt",
            "text/plain",
            SourceKind::Text,
            "First line\nstill first\n\n\nSecond",
        );
        assert_eq!(document.blocks.len(), 2);
        assert_eq!(document.blocks[0].text, "First line\nstill first");
        assert_eq!(
            document.blocks[0].anchor,
            Anchor::Text {
                line_start: 1,
                line_end: 2,
                start: 0,
                end: 22
            }
        );
        assert_eq!(
            document.blocks[1].anchor,
            Anchor::Text {
                line_start: 5,
                line_end: 5,
                start: 25,
                end: 31
            }
        );
    }

    #[test]
    fn markdown_headings_stand_alone() {
        let document = read(
            "notes.md",
            "text/markdown",
            SourceKind::Text,
            "# Cells\nMitochondria\n- ribosomes",
        );
        let kinds: Vec<_> = document.blocks.iter().map(|block| block.kind).collect();
        assert_eq!(kinds, [BlockKind::Heading, BlockKind::Paragraph]);
        assert_eq!(document.blocks[0].text, "# Cells");
    }

    #[test]
    fn markdown_tables_and_lists_keep_their_kind() {
        let document = read(
            "notes.md",
            "text/markdown",
            SourceKind::Text,
            "| a | b |\n|---|---|\n\n- ribosomes",
        );
        let kinds: Vec<_> = document.blocks.iter().map(|block| block.kind).collect();
        assert_eq!(kinds, [BlockKind::Table, BlockKind::ListItem]);
    }

    #[test]
    fn a_markdown_fence_is_one_code_block_across_blank_lines() {
        let document = read(
            "notes.md",
            "text/markdown",
            SourceKind::Text,
            "Intro\n~~~~\nx = 1\n\n~~~\ny = 2\n~~~~~\nAfter",
        );
        let blocks: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect();
        // A shorter fence of the same character does not close it.
        assert_eq!(
            blocks,
            [
                (BlockKind::Paragraph, "Intro"),
                (BlockKind::Code, "~~~~\nx = 1\n\n~~~\ny = 2\n~~~~~"),
                (BlockKind::Paragraph, "After"),
            ]
        );
        assert_eq!(
            document.blocks[1].anchor,
            Anchor::Text {
                line_start: 2,
                line_end: 7,
                start: 6,
                end: 33
            }
        );
    }

    #[test]
    fn a_hash_line_inside_a_fence_is_code_not_a_heading() {
        let document = read(
            "notes.md",
            "text/markdown",
            SourceKind::Text,
            "```python\n# comment\nx = 1\n```\n# Heading",
        );
        let blocks: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect();
        assert_eq!(
            blocks,
            [
                (BlockKind::Code, "```python\n# comment\nx = 1\n```"),
                (BlockKind::Heading, "# Heading"),
            ]
        );
    }

    #[test]
    fn a_fence_left_open_runs_to_the_end_and_tildes_do_not_close_backticks() {
        let document = read(
            "notes.md",
            "text/markdown",
            SourceKind::Text,
            "```\nx\n~~~\ny",
        );
        let blocks: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect();
        assert_eq!(blocks, [(BlockKind::Code, "```\nx\n~~~\ny")]);
    }

    #[test]
    fn inline_code_at_the_start_of_a_line_opens_no_fence() {
        let document = read(
            "notes.md",
            "text/markdown",
            SourceKind::Text,
            "```x``` is how you quote a fence\nstill prose",
        );
        assert_eq!(document.blocks.len(), 1);
        assert_eq!(document.blocks[0].kind, BlockKind::Paragraph);
    }

    #[test]
    fn binary_is_not_text() {
        let input = SourceInput {
            uri: None,
            name: "x.txt".into(),
            kind: SourceKind::Text,
            mime: "text/plain".into(),
            bytes: vec![0xff, 0xfe, 0x00],
        };
        let failure = futures::executor::block_on(TextExtractor.extract(input)).unwrap_err();
        assert_eq!(failure.kind, ErrorKind::InvalidInput);
    }
}
