//! [`Recognized`]: what reading pages returns, page by page.

use serde::{Deserialize, Serialize};

/// Text read from one image or PDF, as Markdown, page by page.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Recognized {
    /// Every page's text in order, separated by blank lines.
    pub text: String,
    pub pages: Vec<PageText>,
}

/// What was read from one page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PageText {
    /// 1-based page number within the input.
    pub number: usize,
    /// Markdown; tables and formulas are kept when the provider recognises them.
    pub text: String,
}

impl Recognized {
    /// Joins pages read separately. Pages with no text are kept, so numbering stays intact,
    /// but add nothing to [`Self::text`].
    pub fn stitch(pages: impl IntoIterator<Item = PageText>) -> Self {
        let pages: Vec<PageText> = pages
            .into_iter()
            .map(|page| PageText {
                number: page.number,
                text: page.text.trim().to_owned(),
            })
            .collect();
        let text = pages
            .iter()
            .map(|page| page.text.as_str())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        Self { text, pages }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(number: usize, text: &str) -> PageText {
        PageText {
            number,
            text: text.into(),
        }
    }

    #[test]
    fn stitch_trims_pages_and_joins_them_with_blank_lines() {
        let document = Recognized::stitch([page(1, "  # Title \n"), page(2, "Body")]);
        assert_eq!(document.text, "# Title\n\nBody");
        assert_eq!(document.pages[0].text, "# Title");
    }

    #[test]
    fn blank_pages_keep_their_number_but_add_no_text() {
        let document = Recognized::stitch([page(1, "one"), page(2, " \n"), page(3, "three")]);
        assert_eq!(document.text, "one\n\nthree");
        let numbers: Vec<usize> = document.pages.iter().map(|p| p.number).collect();
        assert_eq!(numbers, [1, 2, 3]);
    }
}
