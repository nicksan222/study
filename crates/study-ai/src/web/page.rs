//! [`fetch_page`]: a web page's HTML and charset.

use std::time::Duration;

use super::{Error, Result};
use crate::http::{Timeouts, public_client};

/// Largest page kept.
const MAX_BYTES: u64 = 16 * 1024 * 1024;

/// A fetched web page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    /// Where it ended up after redirects.
    pub url: String,
    /// The `charset` its `Content-Type` names, lowercased; `None` when it names none.
    pub charset: Option<String>,
    pub html: Vec<u8>,
}

/// Whether `url` is an `http` or `https` address, whatever the case of its scheme.
pub fn is_page(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

/// Fetches the HTML at `url`.
///
/// Up to 10 redirects are followed, but never down from `https` to `http`, even within one
/// host. Nor are they followed onto this computer or its network (a loopback, private,
/// shared (100.64.0.0/10), link-local or unspecified IP address, or `localhost`), unless
/// they stay at the host and port of `url` itself. Only addresses as written are checked:
/// a public name that resolves to a private address is followed. A refused redirect fails
/// as [`Error::Http`], of kind invalid input.
pub async fn fetch_page(url: &str) -> Result<Page> {
    if !is_page(url) {
        return Err(Error::Address(url.to_owned()));
    }
    let client = public_client(Timeouts::api(Duration::from_secs(60)))?;
    let mut response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "Study (desktop study app)")
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(Error::Status(status.as_u16()));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/html")
        .to_owned();
    if !mime.starts_with("text/html") && !mime.starts_with("application/xhtml") {
        return Err(Error::NotAPage(mime));
    }
    let final_url = response.url().to_string();
    let mut html = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        html.extend_from_slice(&chunk);
        if html.len() as u64 > MAX_BYTES {
            return Err(Error::TooLarge(MAX_BYTES));
        }
    }
    Ok(Page {
        charset: charset(&mime),
        url: final_url,
        html,
    })
}

/// The `charset` parameter of `content_type`, lowercased and unquoted, as sent; an empty
/// one names no charset.
fn charset(content_type: &str) -> Option<String> {
    content_type.split(';').skip(1).find_map(|parameter| {
        let (name, value) = parameter.split_once('=')?;
        let value = value.trim().trim_matches('"');
        (name.trim().eq_ignore_ascii_case("charset") && !value.is_empty())
            .then(|| value.to_ascii_lowercase())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_addresses_are_pages() {
        assert!(is_page("https://example.org/notes"));
        assert!(is_page("HTTP://example.org"));
        assert!(!is_page("ftp://example.org"));
        assert!(!is_page("example.org"));
    }

    #[test]
    fn the_charset_is_read_from_the_content_type() {
        assert_eq!(
            charset(r#"text/html; Charset="ISO-8859-1""#).as_deref(),
            Some("iso-8859-1")
        );
        assert_eq!(
            charset("text/html;level=1; CHARSET = UTF-8 ").as_deref(),
            Some("utf-8")
        );
        assert_eq!(charset("text/html"), None);
        assert_eq!(charset("text/html; level=1"), None);
        assert_eq!(charset("text/html; charset="), None);
        assert_eq!(charset(r#"text/html; charset="""#), None);
    }
}
