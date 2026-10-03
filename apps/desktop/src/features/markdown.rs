//! Markdown as models write it, read one line at a time for display: what each line is
//! (heading, list item, quote, code fence, rule or paragraph), and which stretches of it are set apart
//! (bold, italics and citation markers such as `[2]`). Deliberately small: models write
//! plain markdown, and anything this does not know shows as written.

use std::ops::Range;

/// One line of markdown, by what it is; a numbered item keeps its marker, such as `2.`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Line<'a> {
    /// `## Title`: its level (the number of `#`) and its text.
    Heading(usize, &'a str),
    /// `- item`, `* item` or `• item`.
    Bullet(&'a str),
    /// `2. item` or `2) item`: its marker and its text.
    Numbered(&'a str, &'a str),
    /// `> quoted`.
    Quote(&'a str),
    /// ```` ```rust ````: opens or closes a block of code, with the language it names.
    Fence(&'a str),
    /// `---`, `***` or `___`: a break between parts.
    Rule,
    /// Anything else, as written.
    Paragraph(&'a str),
}

impl<'a> Line<'a> {
    /// What `line` is. A `#` with no space after it is a paragraph, as a hashtag is.
    pub fn of(line: &'a str) -> Self {
        if let Some(language) = line.strip_prefix("```") {
            return Self::Fence(language.trim());
        }
        let first = line.chars().next();
        if line.len() >= 3
            && matches!(first, Some('-' | '*' | '_'))
            && line.chars().all(|c| Some(c) == first)
        {
            return Self::Rule;
        }
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if hashes > 0
            && let Some(rest) = line[hashes..].strip_prefix(' ')
        {
            return Self::Heading(hashes, rest.trim());
        }
        if let Some(rest) = ["- ", "* ", "• "]
            .iter()
            .find_map(|bullet| line.strip_prefix(bullet))
        {
            return Self::Bullet(rest.trim());
        }
        if let Some(rest) = line.strip_prefix('>') {
            return Self::Quote(rest.trim());
        }
        let digits = line.chars().take_while(char::is_ascii_digit).count();
        if (1..=3).contains(&digits)
            && let Some(rest) = line[digits..]
                .strip_prefix(". ")
                .or_else(|| line[digits..].strip_prefix(") "))
        {
            return Self::Numbered(&line[..=digits], rest.trim());
        }
        Self::Paragraph(line)
    }

    /// The line's text without its marker.
    pub fn text(&self) -> &'a str {
        match self {
            Self::Heading(_, text)
            | Self::Bullet(text)
            | Self::Numbered(_, text)
            | Self::Quote(text)
            | Self::Paragraph(text) => text,
            Self::Fence(_) | Self::Rule => "",
        }
    }
}

/// How a stretch of a line is set apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    /// `**bold**`.
    Strong,
    /// `*italics*`.
    Emphasis,
    /// A citation marker such as `[2]`, kept with its brackets.
    Citation,
}

/// A line without its markdown punctuation, and the stretches to set apart. Backticks are
/// dropped; an unclosed `**` or `*` stays as written.
pub fn inline(line: &str) -> (String, Vec<(Range<usize>, Mark)>) {
    let mut shown = String::with_capacity(line.len());
    let mut marks = Vec::new();
    let mut rest = line;
    while let Some(c) = rest.chars().next() {
        let closed = |open: &str| {
            rest.strip_prefix(open).and_then(|after| {
                after
                    .find(open)
                    .filter(|end| *end > 0)
                    .map(|end| (&after[..end], &after[end + open.len()..]))
            })
        };
        if let Some((inner, after)) = closed("**") {
            set_apart(&mut shown, &mut marks, inner, Mark::Strong);
            rest = after;
        // A `*` followed by a space is arithmetic, as in `2 * 3`, not italics.
        } else if let Some((inner, after)) =
            closed("*").filter(|(inner, _)| !inner.starts_with(' '))
        {
            set_apart(&mut shown, &mut marks, inner, Mark::Emphasis);
            rest = after;
        } else if let Some(end) = rest
            .strip_prefix('[')
            .and_then(|after| after.find(']'))
            .filter(|end| {
                (1..=3).contains(end) && rest[1..=*end].chars().all(|c| c.is_ascii_digit())
            })
        {
            set_apart(&mut shown, &mut marks, &rest[..end + 2], Mark::Citation);
            rest = &rest[end + 2..];
        } else {
            if c != '`' {
                shown.push(c);
            }
            rest = &rest[c.len_utf8()..];
        }
    }
    (shown, marks)
}

/// Appends `text` to `shown`, marked as `mark`.
fn set_apart(shown: &mut String, marks: &mut Vec<(Range<usize>, Mark)>, text: &str, mark: Mark) {
    let start = shown.len();
    shown.push_str(text);
    marks.push((start..shown.len(), mark));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_read_by_what_they_are() {
        assert_eq!(Line::of("## Phases"), Line::Heading(2, "Phases"));
        assert_eq!(Line::of("#hashtag"), Line::Paragraph("#hashtag"));
        assert_eq!(Line::of("- one"), Line::Bullet("one"));
        assert_eq!(Line::of("12. twelve"), Line::Numbered("12.", "twelve"));
        assert_eq!(Line::of("2024 was"), Line::Paragraph("2024 was"));
        assert_eq!(Line::of("> said"), Line::Quote("said"));
        assert_eq!(Line::of("```rust"), Line::Fence("rust"));
        assert_eq!(Line::of("```"), Line::Fence(""));
        assert_eq!(Line::of("---"), Line::Rule);
        assert_eq!(Line::of("-- -"), Line::Paragraph("-- -"));
    }

    #[test]
    fn inline_marks_drop_their_punctuation() {
        let (shown, marks) = inline("The **spindle** pulls *sister* `chromatids` apart [2].");
        assert_eq!(shown, "The spindle pulls sister chromatids apart [2].");
        let marked: Vec<_> = marks
            .iter()
            .map(|(range, mark)| (&shown[range.clone()], *mark))
            .collect();
        assert_eq!(
            marked,
            [
                ("spindle", Mark::Strong),
                ("sister", Mark::Emphasis),
                ("[2]", Mark::Citation),
            ]
        );
        assert_eq!(inline("2 * 3 = 6 [a]").0, "2 * 3 = 6 [a]");
        assert_eq!(inline("**open").0, "**open");
    }
}
