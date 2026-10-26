//! Reading pages with the vision provider on a mock of the ChatGPT plan: one server stands
//! in for both the sign-in server and the Responses API.

use std::num::NonZeroUsize;
use std::time::Duration;

use base64::Engine as _;
use study_ai::BatchingConfig;
use study_ai::chat::{Models, ModelsConfig, ProviderConfig, Tier};
use study_ai::testing::{RESPONSES_PATH, answer, incomplete, plan, signed_in};
use study_ai::vision::{ProviderConfig as PageReader, Recognizer, RecognizerConfig};
use study_core::Language;
use study_core::{Classify as _, ErrorKind};
use study_media::pages::{DocumentInput, Pages, encode_png};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Two US Letter pages, each with one line of Helvetica.
const PDF: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../study-media/tests/fixtures/two_pages.pdf"
);

/// A reader whose every tier runs on `plan`.
fn reader(plan: ProviderConfig) -> Recognizer {
    Recognizer::start(reader_config(plan))
}

/// A reader on `plan` that sends pages only in pairs, so two pages always share a batch
/// however slowly they render.
fn pairing_reader(plan: ProviderConfig) -> Recognizer {
    Recognizer::start(RecognizerConfig {
        batching: BatchingConfig {
            max_batch_size: NonZeroUsize::new(2),
            max_wait: Duration::from_secs(60),
            ..BatchingConfig::default()
        },
        ..reader_config(plan)
    })
}

fn reader_config(plan: ProviderConfig) -> RecognizerConfig {
    let models = Models::build(ModelsConfig::from_fn(|_| plan.clone())).unwrap();
    RecognizerConfig::new(PageReader::Model(
        models.model(Tier::Medium),
        Language::Italian,
    ))
}

#[tokio::test]
async fn every_page_is_seen_by_the_model_and_its_reading_kept_in_order() {
    let (server, plan) = signed_in().await;
    // Each page goes as an image, with instructions to explain its figures too.
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .and(body_string_contains("input_image"))
        .and(body_string_contains("data:image/png;base64,"))
        .and(body_string_contains("**Figure:**"))
        // Figures are described in the language the student chose.
        .and(body_string_contains("in Italian"))
        .respond_with(answer(
            "```markdown\n# Cells\n\n**Figure:** a mitochondrion, labelled.\n```",
        ))
        .expect(2)
        .mount(&server)
        .await;

    let read = reader(plan)
        .recognize(DocumentInput::File(PDF.into()))
        .await
        .unwrap();
    assert_eq!(read.pages.len(), 2);
    assert_eq!(read.pages[0].number, 1);
    // The model's fence is not part of the page.
    assert_eq!(
        read.pages[1].text,
        "# Cells\n\n**Figure:** a mitochondrion, labelled."
    );
}

#[tokio::test]
async fn reading_before_signing_in_is_a_setup_problem() {
    let server = MockServer::start().await;
    let error = reader(plan(&server, None))
        .recognize(DocumentInput::File(PDF.into()))
        .await
        .unwrap_err();
    // So signing in retries the reads that failed for want of it.
    assert_eq!(error.kind(), ErrorKind::Config);
}

/// The first page of [`PDF`] as the model is sent it, so a mock can tell it apart.
fn first_page_as_sent() -> String {
    let pages = Pages::open(DocumentInput::File(PDF.into())).unwrap();
    // The size the language model reader renders pages at.
    let page = pages.page(0, 2_048).unwrap();
    base64::engine::general_purpose::STANDARD.encode(encode_png(&page))
}

/// A page the plan's content filter stops is kept empty; the other page is read all the same,
/// and nothing is read twice.
#[tokio::test]
async fn a_page_the_model_would_not_read_is_kept_empty_and_the_rest_read() {
    let (server, plan) = signed_in().await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(answer("# Second"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .and(body_string_contains(first_page_as_sent()))
        .respond_with(incomplete("", "content_filter"))
        .with_priority(1)
        .expect(1)
        .mount(&server)
        .await;

    let read = reader(plan)
        .recognize(DocumentInput::File(PDF.into()))
        .await
        .unwrap();
    let pages: Vec<(usize, &str)> = read
        .pages
        .iter()
        .map(|page| (page.number, page.text.as_str()))
        .collect();
    assert_eq!(pages, [(1, ""), (2, "# Second")]);
    assert_eq!(read.text, "# Second");
}

/// A PDF of two identical pages, each one blue box, so the reader sends them as one item
/// when they are in one batch.
fn two_identical_pages() -> Vec<u8> {
    let content = "0.3 0.5 0.9 rg 60 470 200 90 re f\n";
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>".to_owned(),
        format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        ),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

/// A page repeated in one batch is read once; when the model would not read it, every
/// copy is kept empty, not only the first, and the document is still read.
#[tokio::test]
async fn a_repeated_page_the_model_would_not_read_is_kept_empty_everywhere() {
    let (server, plan) = signed_in().await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(incomplete("", "content_filter"))
        .expect(1)
        .mount(&server)
        .await;

    let read = pairing_reader(plan)
        .recognize(DocumentInput::Encoded {
            bytes: two_identical_pages(),
            kind: None,
        })
        .await
        .unwrap();
    let pages: Vec<(usize, &str)> = read
        .pages
        .iter()
        .map(|page| (page.number, page.text.as_str()))
        .collect();
    assert_eq!(pages, [(1, ""), (2, "")]);
}

/// A rate limit is not one page's problem: reading stops, to run again later.
#[tokio::test]
async fn a_rate_limit_still_fails_the_reading() {
    let (server, plan) = signed_in().await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(ResponseTemplate::new(429))
        .mount(&server)
        .await;
    let error = reader(plan)
        .recognize(DocumentInput::File(PDF.into()))
        .await
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::RateLimited);
}
