//! Places in a source, named the same way on every screen.

use study_core::Anchor;

use super::{text::joined, time::timestamp};
use crate::Locale;

/// A citation as a reader sees it: `[2] slides.pdf · p. 3`, or `[1] example.org page` for
/// a place [`anchor_label`] leaves unnamed.
pub fn citation_label(locale: Locale, marker: u32, source: &str, anchor: &Anchor) -> String {
    let place = anchor_label(locale, anchor).unwrap_or_default();
    format!("[{marker}] {}", joined(&[source.to_owned(), place]))
}

/// Where in a source a passage comes from, such as `p. 3`, `4:05–4:40`, `lines 12–18` or a
/// web page's `#section`. `None` for a whole web page: its address is the source, not a
/// place in it.
pub fn anchor_label(locale: Locale, anchor: &Anchor) -> Option<String> {
    Some(match anchor {
        // A span that ends within its first second would read `4:05–4:05`; it is a moment.
        Anchor::Time { start_ms, end_ms } if end_ms / 1000 > start_ms / 1000 => {
            format!("{}–{}", timestamp(*start_ms), timestamp(*end_ms))
        }
        Anchor::Time { start_ms, .. } => timestamp(*start_ms),
        Anchor::Page { page } => match locale {
            Locale::English => format!("p. {page}"),
            Locale::Italian => format!("pag. {page}"),
        },
        Anchor::Text {
            line_start,
            line_end,
            ..
        } => match (locale, line_start == line_end) {
            (Locale::English, true) => format!("line {line_start}"),
            (Locale::English, false) => format!("lines {line_start}–{line_end}"),
            (Locale::Italian, true) => format!("riga {line_start}"),
            (Locale::Italian, false) => format!("righe {line_start}–{line_end}"),
        },
        Anchor::Slide { index } => match locale {
            Locale::English => format!("slide {index}"),
            Locale::Italian => format!("diapositiva {index}"),
        },
        Anchor::Paragraph { index } => match locale {
            Locale::English => format!("¶ {index}"),
            Locale::Italian => format!("§ {index}"),
        },
        Anchor::Url {
            fragment: Some(id), ..
        } => format!("#{id}"),
        Anchor::Url { fragment: None, .. } => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_read_as_places_in_the_source() {
        let en = Locale::English;
        assert_eq!(anchor_label(en, &Anchor::Page { page: 3 }).unwrap(), "p. 3");
        assert_eq!(
            anchor_label(Locale::Italian, &Anchor::Page { page: 3 }).unwrap(),
            "pag. 3"
        );
        let span = Anchor::Time {
            start_ms: 245_000,
            end_ms: 280_400,
        };
        assert_eq!(anchor_label(en, &span).unwrap(), "4:05–4:40");
        let moment = Anchor::Time {
            start_ms: 3_723_000,
            end_ms: 3_723_500,
        };
        assert_eq!(anchor_label(en, &moment).unwrap(), "1:02:03");
        let lines = Anchor::Text {
            line_start: 12,
            line_end: 18,
            start: 0,
            end: 1,
        };
        assert_eq!(anchor_label(en, &lines).unwrap(), "lines 12–18");
    }

    #[test]
    fn a_web_page_is_placed_by_its_section_alone() {
        let page = |fragment: Option<&str>| Anchor::Url {
            url: "https://example.org/page".to_owned(),
            fragment: fragment.map(str::to_owned),
        };
        assert_eq!(
            anchor_label(Locale::English, &page(Some("mitosis"))).as_deref(),
            Some("#mitosis")
        );
        assert_eq!(anchor_label(Locale::English, &page(None)), None);
        assert_eq!(
            citation_label(Locale::English, 1, "example.org page", &page(None)),
            "[1] example.org page"
        );
        assert_eq!(
            citation_label(
                Locale::English,
                2,
                "example.org page",
                &page(Some("mitosis"))
            ),
            "[2] example.org page · #mitosis"
        );
    }
}
