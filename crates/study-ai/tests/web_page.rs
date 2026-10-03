//! Fetching web pages: addresses refused before any request, the charset a mock server
//! names, the redirects a page may follow, and, in `docker`, a real web server (nginx)
//! serving a course site.

use std::time::{Duration, Instant};

use study_ai::web::{Error, fetch_page};
use study_core::{Classify as _, ErrorKind};
use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};

/// A server answering `/lecture.html` with a short page of `content_type`.
async fn serving(content_type: &str) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(path("/lecture.html"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw("<title>Cells</title>".as_bytes(), content_type),
        )
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn a_page_keeps_the_charset_its_server_names() {
    let server = serving("text/html; charset=windows-1252").await;
    let page = fetch_page(&format!("{}/lecture.html", server.uri()))
        .await
        .unwrap();
    assert_eq!(page.charset.as_deref(), Some("windows-1252"));
}

#[tokio::test]
async fn a_page_whose_server_names_no_charset_has_none() {
    let server = serving("text/html").await;
    let page = fetch_page(&format!("{}/lecture.html", server.uri()))
        .await
        .unwrap();
    assert_eq!(page.charset, None);
}

/// A server whose `/start` redirects to `location`, and whose `/other` is a page.
async fn redirecting_to(location: &str) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(path("/start"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", location))
        .mount(&server)
        .await;
    Mock::given(path("/other"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw("<title>Other</title>".as_bytes(), "text/html"),
        )
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn a_local_page_may_redirect_within_itself() {
    let server = redirecting_to("/other").await;
    let page = fetch_page(&format!("{}/start", server.uri()))
        .await
        .unwrap();
    assert_eq!(page.url, format!("{}/other", server.uri()));
    assert_eq!(page.html, b"<title>Other</title>");
}

#[tokio::test]
async fn a_redirect_onto_this_computer_or_its_network_is_refused_at_once() {
    let local = redirecting_to("/other").await;
    let port = local.address().port();
    for location in [
        format!("http://localhost:{port}/other"),
        "http://10.0.0.1/".to_owned(),
        "http://169.254.169.254/".to_owned(),
    ] {
        let server = redirecting_to(&location).await;
        let started = Instant::now();
        let error = fetch_page(&format!("{}/start", server.uri()))
            .await
            .unwrap_err();
        assert!(
            matches!(&error, Error::Http(http) if http.is_redirect()),
            "{location}: {error}"
        );
        assert_eq!(error.kind(), ErrorKind::InvalidInput, "{location}");
        // Nothing listens at the private addresses: a connection attempt would wait seconds.
        assert!(started.elapsed() < Duration::from_secs(1), "{location}");
    }
}

#[tokio::test]
async fn an_address_that_is_not_a_web_page_is_refused_before_any_request() {
    for address in [
        "file:///etc/passwd",
        "ftp://example.org/notes.html",
        "notes",
    ] {
        let error = fetch_page(address).await.unwrap_err();
        assert!(matches!(error, Error::Address(_)), "{address}: {error}");
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
    }
}

#[tokio::test]
async fn an_address_where_nothing_answers_is_worth_retrying() {
    // A port just freed: nothing listens on it.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/lecture.html", listener.local_addr().unwrap());
    drop(listener);

    let error = fetch_page(&address).await.unwrap_err();
    assert!(matches!(error, Error::Http(_)), "{error}");
    assert_eq!(error.kind(), ErrorKind::Transient);
}

mod docker {
    use std::path::PathBuf;

    use study_ai::web::{Error, fetch_page};
    use study_core::{Classify as _, ErrorKind};
    use study_testkit::web::Site;

    const LECTURE: &str = "/lectures/photosynthesis.html";

    fn course_files() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/web")
    }

    async fn course_site() -> Site {
        Site::serve(
            &course_files(),
            &[("/l/7", "/lezione-7"), ("/lezione-7", LECTURE)],
        )
        .await
    }

    #[tokio::test]
    async fn a_shared_link_follows_its_redirects_to_the_lecture() {
        let site = course_site().await;

        let page = fetch_page(&site.url("/l/7")).await.unwrap();

        assert_eq!(page.url, site.url(LECTURE));
        assert_eq!(
            page.html,
            std::fs::read(course_files().join(LECTURE.trim_start_matches('/'))).unwrap()
        );
        let html = String::from_utf8(page.html).unwrap();
        assert!(html.contains("L'equazione complessiva è"));
    }

    #[tokio::test]
    async fn data_and_missing_pages_fail_with_a_kind_the_user_can_act_on() {
        let site = course_site().await;

        let error = fetch_page(&site.url("/api/lectures.json"))
            .await
            .unwrap_err();
        let Error::NotAPage(mime) = &error else {
            panic!("JSON is not a page: {error}");
        };
        assert!(mime.starts_with("application/json"), "{mime}");
        assert_eq!(error.kind(), ErrorKind::InvalidInput);

        let error = fetch_page(&site.url("/lectures/8.html")).await.unwrap_err();
        assert!(matches!(error, Error::Status(404)), "{error}");
        assert_eq!(error.kind(), ErrorKind::NotFound);
    }
}
