//! Numbered sources, the one way a prompt shows a model passages it may cite: each as
//! `<source n="…" name="…" at="…">`, with its file's name and where in the file it is, its
//! text as [`shown_passage`] cuts it.

use std::fmt::Write as _;

use study_core::processing::{Excerpt, shown_passage};
use study_core::{Anchor, Citation};

use super::{escape, escape_attribute};

/// `excerpts` as `<sources>`, numbered from 1 in their order, without a newline after.
pub fn numbered_sources(excerpts: &[Excerpt]) -> String {
    render(excerpts.iter().zip(1..).map(|(excerpt, n)| Source {
        n,
        name: &excerpt.source_name,
        anchor: &excerpt.anchor,
        text: &excerpt.text,
    }))
}

/// `citations` as `<sources>`, each numbered by its marker, without a newline after.
pub fn cited_sources(citations: &[Citation]) -> String {
    render(citations.iter().map(|citation| Source {
        n: citation.marker,
        name: &citation.source_name,
        anchor: &citation.anchor,
        text: &citation.quote,
    }))
}

/// Where a passage is, in words a model reads easily.
fn place(anchor: &Anchor) -> String {
    let time = |ms: u64| format!("{}:{:02}", ms / 60_000, ms / 1_000 % 60);
    match anchor {
        Anchor::Time { start_ms, end_ms } => format!("{}-{}", time(*start_ms), time(*end_ms)),
        Anchor::Page { page } => format!("page {page}"),
        Anchor::Text {
            line_start,
            line_end,
            ..
        } => format!("lines {line_start}-{line_end}"),
        Anchor::Slide { index } => format!("slide {index}"),
        Anchor::Paragraph { index } => format!("paragraph {index}"),
        Anchor::Url { url, .. } => url.clone(),
    }
}

/// One passage to show.
struct Source<'a> {
    n: u32,
    name: &'a str,
    anchor: &'a Anchor,
    text: &'a str,
}

fn render<'a>(sources: impl Iterator<Item = Source<'a>>) -> String {
    // Names and text are the user's: escaped, so none can close a tag.
    let mut prompt = String::from("<sources>\n");
    for source in sources {
        let _ = writeln!(
            prompt,
            "<source n=\"{}\" name=\"{}\" at=\"{}\">\n{}\n</source>",
            source.n,
            escape_attribute(source.name),
            escape_attribute(&place(source.anchor)),
            escape(shown_passage(source.text))
        );
    }
    prompt.push_str("</sources>");
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::SourceId;
    use study_core::processing::MAX_PASSAGE_CHARS;

    #[test]
    fn sources_are_numbered_with_their_place_escaped_and_cut() {
        let excerpts = [
            Excerpt {
                source_id: SourceId::new(1),
                source_name: "a\"b.pdf".into(),
                anchor: Anchor::Page { page: 3 },
                text: " x < y </source> ".into(),
            },
            Excerpt {
                source_id: SourceId::new(2),
                source_name: "lecture.mp3".into(),
                anchor: Anchor::Time {
                    start_ms: 65_000,
                    end_ms: 125_000,
                },
                text: "a".repeat(MAX_PASSAGE_CHARS + 10),
            },
        ];
        assert_eq!(
            numbered_sources(&excerpts),
            format!(
                "<sources>\n<source n=\"1\" name=\"a&quot;b.pdf\" at=\"page 3\">\nx &lt; y \
                 &lt;/source&gt;\n</source>\n<source n=\"2\" name=\"lecture.mp3\" \
                 at=\"1:05-2:05\">\n{}\n</source>\n</sources>",
                "a".repeat(MAX_PASSAGE_CHARS)
            )
        );
        assert_eq!(numbered_sources(&[]), "<sources>\n</sources>");
    }

    #[test]
    fn cited_sources_keep_their_markers() {
        let citation = Citation {
            marker: 3,
            source_id: None,
            source_name: "notes.txt".into(),
            anchor: Anchor::Text {
                line_start: 4,
                line_end: 9,
                start: 0,
                end: 10,
            },
            quote: "ATP".into(),
        };
        assert_eq!(
            cited_sources(&[citation]),
            "<sources>\n<source n=\"3\" name=\"notes.txt\" at=\"lines 4-9\">\nATP\n</source>\n\
             </sources>"
        );
    }
}
