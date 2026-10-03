//! A web page's HTML, listed under its title, and stored as UTF-8 when its headers name
//! another charset.

use encoding_rs::UTF_8;
use scraper::{ElementRef, Html};
use study_ai::web;
use study_core::jobs::off_thread;
use study_core::processing::{BoxFuture, Fetched, Fetcher, FetcherKind};
use study_core::text::collapse_whitespace;
use study_core::{Failure, SourceKind, mime};

use crate::extract::{charset_encoding, decode};

/// The UTF-8 byte order mark.
const UTF_8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// Fetches pages.
pub(super) struct PageFetcher;

impl Fetcher for PageFetcher {
    fn kind(&self) -> FetcherKind {
        FetcherKind::Page
    }

    fn accepts(&self, url: &str) -> bool {
        web::is_page(url)
    }

    fn fetch<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<Fetched, Failure>> {
        Box::pin(async move {
            let page = web::fetch_page(url).await?;
            let (html, charset) = (page.html, page.charset);
            // Decoded and parsed on the blocking pool, so a large page does not stall the
            // runtime.
            let (bytes, title) = off_thread(move || {
                let bytes = transcoded(html, charset.as_deref());
                let title = title(&bytes);
                (bytes, title)
            })
            .await?;
            Ok(Fetched {
                name: title.unwrap_or_else(|| page.url.clone()),
                bytes,
                kind: SourceKind::Web,
                mime: mime::HTML.to_owned(),
                uri: page.url,
            })
        })
    }
}

/// `html` as stored: re-encoded as UTF-8 behind a byte order mark when `charset`, from its
/// headers, names another encoding, so the mark outranks whatever its `<meta>` says when it
/// is read; as it came otherwise. A byte order mark of its own outranks `charset`.
fn transcoded(html: Vec<u8>, charset: Option<&str>) -> Vec<u8> {
    let Some(encoding) = charset
        .and_then(charset_encoding)
        .filter(|encoding| *encoding != UTF_8)
    else {
        return html;
    };
    let text = encoding.decode(&html).0;
    [UTF_8_BOM, text.as_bytes()].concat()
}

/// The text of the page's first `<title>`, on one line, read as the extractor reads the
/// page; `None` when it has none, or an empty one.
fn title(html: &[u8]) -> Option<String> {
    let page = Html::parse_document(&decode(html));
    let title = page
        .root_element()
        .descendants()
        .filter_map(ElementRef::wrap)
        .find(|element| element.value().name() == "title")?;
    Some(collapse_whitespace(&title.text().collect::<String>())).filter(|title| !title.is_empty())
}

#[cfg(test)]
mod tests {
    use study_core::processing::{Extractor, SourceInput};
    use study_core::{BlockKind, SourceKind};

    use super::*;
    use crate::WebExtractor;

    /// A page in windows-1252 whose `<meta>` wrongly says UTF-8.
    const LATIN: &[u8] = b"<html><head><meta charset=\"utf-8\"><title> Caf\xe9\n cr\xe8me </title>\
        </head><body><p>D\xe9j\xe0 vu</p></body></html>";

    #[tokio::test]
    async fn a_page_in_another_charset_is_stored_as_utf8_and_read_right() {
        let bytes = transcoded(LATIN.to_vec(), Some("windows-1252"));
        assert!(bytes.starts_with(b"\xEF\xBB\xBF"));
        assert_eq!(title(&bytes).as_deref(), Some("Café crème"));
        let input = SourceInput {
            uri: None,
            name: "Café crème".into(),
            kind: SourceKind::Web,
            mime: mime::HTML.into(),
            bytes,
        };
        let document = WebExtractor.extract(input).await.unwrap();
        let blocks: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str()))
            .collect();
        assert_eq!(blocks, [(BlockKind::Paragraph, "Déjà vu")]);
    }

    #[test]
    fn a_page_in_utf8_or_without_a_charset_is_stored_as_it_came() {
        let html = b"<title>Cells\tand  tissues</title><p>x</p>";
        for charset in [None, Some("utf-8")] {
            assert_eq!(transcoded(html.to_vec(), charset), html);
        }
        assert_eq!(title(html).as_deref(), Some("Cells and tissues"));
        // The title is read in the charset the page's `<meta>` names.
        assert_eq!(
            title(b"<meta charset=\"windows-1252\"><title>Caf\xe9</title>").as_deref(),
            Some("Café")
        );
        assert_eq!(title(b"<title> </title>"), None);
    }
}
