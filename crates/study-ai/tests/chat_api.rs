//! The ChatGPT plan provider against a mock of OpenAI: one server stands in for both the
//! sign-in server (`/api/accounts/oauth/token`) and the Responses API (`/responses`).

use std::time::Duration;

use serde_json::json;
use study_ai::chat::provider::chatgpt::{HostId, SignIn, revoke};
use study_ai::testing::{
    CLIENT_ID, MODEL, RESPONSES_PATH, REVOKE_PATH, TOKEN_PATH, account, answer, incomplete, plan,
    tokens,
};
use study_core::{Classify as _, ErrorKind};
use wiremock::matchers::{body_partial_json, body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn a_prompt_runs_on_the_plan_with_a_renewed_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .and(body_string_contains("grant_type=refresh_token"))
        .and(body_string_contains("refresh_token=first-refresh"))
        .and(body_string_contains(format!("client_id={CLIENT_ID}")))
        .respond_with(tokens("access-1", "second-refresh"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .and(header("authorization", "Bearer access-1"))
        .and(body_partial_json(json!({
            "model": MODEL, "stream": true, "store": false
        })))
        .respond_with(answer("OK"))
        .expect(2)
        .mount(&server)
        .await;

    let config = plan(&server, Some(account("first-refresh")));
    config.clone().check_connection().await.unwrap();
    // The access token is kept: the second prompt renews nothing.
    config.check_connection().await.unwrap();
}

#[tokio::test]
async fn a_refused_token_is_renewed_once_before_the_request_fails() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(tokens("access", "next-refresh"))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "error": {"code": "subscription_sharing_invalid_user", "message": "revoked"}
        })))
        .expect(2)
        .mount(&server)
        .await;

    let error = plan(&server, Some(account("refresh")))
        .check_connection()
        .await
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Config, "{error}");
}

#[tokio::test]
async fn plan_refusals_keep_their_kind() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(tokens("access", "next"))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(RESPONSES_PATH))
        .respond_with(ResponseTemplate::new(429).set_body_json(json!({
            "error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "limit"}
        })))
        .mount(&server)
        .await;
    let error = plan(&server, Some(account("refresh")))
        .check_connection()
        .await
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::RateLimited, "{error}");

    let dead = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": "refresh_token_reused", "error_description": "already used"
        })))
        .mount(&dead)
        .await;
    let error = plan(&dead, Some(account("used")))
        .check_connection()
        .await
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Config, "{error}");
}

#[tokio::test]
async fn an_answer_cut_short_is_not_saved_as_finished() {
    for (reason, kind) in [
        ("max_output_tokens", ErrorKind::Transient),
        ("content_filter", ErrorKind::InvalidInput),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(TOKEN_PATH))
            .respond_with(tokens("access", "next"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .respond_with(incomplete("Half an ans", reason))
            .mount(&server)
            .await;
        let error = plan(&server, Some(account("refresh")))
            .check_connection()
            .await
            .unwrap_err();
        assert_eq!(error.kind(), kind, "{reason}: {error}");
    }
}

/// Runs in real time, three seconds of waits between attempts: paused time would also
/// skip ahead through the HTTP client's own timeouts while the server answers.
#[tokio::test]
async fn signing_out_retries_until_the_sign_in_server_answers() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(REVOKE_PATH))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(2)
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REVOKE_PATH))
        .and(body_string_contains("token=refresh"))
        .and(body_string_contains(format!("client_id={CLIENT_ID}")))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    revoke(&server.uri(), &account("refresh")).await.unwrap();
}

#[tokio::test]
async fn signing_out_a_sign_in_that_no_longer_works_is_done() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(REVOKE_PATH))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": "invalid_grant", "error_description": "already revoked"
        })))
        .expect(1)
        .mount(&server)
        .await;

    revoke(&server.uri(), &account("refresh")).await.unwrap();
}

#[tokio::test]
async fn nobody_signed_in_is_a_setup_problem() {
    let server = MockServer::start().await;
    let error = plan(&server, None).check_connection().await.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Config);
}

#[tokio::test]
async fn signing_in_registers_study_and_reads_the_account() {
    let server = MockServer::start().await;
    let host = HostId::generate();
    let sign_in = SignIn::start(&server.uri(), &host, None, false)
        .await
        .unwrap();
    let nonce = authorize_param(&sign_in, "nonce");
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .and(body_string_contains("grant_type=authorization_code"))
        .and(body_string_contains("code=the-code"))
        .and(body_string_contains(format!("client_id={CLIENT_ID}")))
        .and(body_string_contains("code_verifier="))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "access", "refresh_token": "refresh", "token_type": "Bearer",
            "expires_in": 3600, "id_token": id_token(&server.uri(), CLIENT_ID, &nonce),
            "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
        })))
        .expect(1)
        .mount(&server)
        .await;
    browser_returns(&sign_in, |state| {
        format!("code=the-code&state={state}&client_id={CLIENT_ID}")
    })
    .await;

    let account = sign_in.finish(Duration::from_secs(10)).await.unwrap();
    assert_eq!(account.client_id, CLIENT_ID);
    assert_eq!(account.subject, "user-signin");
    assert_eq!(account.email.as_deref(), Some("ada@example.com"));
    assert!(account.sharing && account.is_usable());
}

#[tokio::test]
async fn idle_and_broken_browser_connections_do_not_hold_up_the_sign_in() {
    let server = MockServer::start().await;
    let sign_in = SignIn::start(&server.uri(), &HostId::generate(), Some("issued"), false)
        .await
        .unwrap();
    let nonce = authorize_param(&sign_in, "nonce");
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "access", "refresh_token": "refresh", "token_type": "Bearer",
            "id_token": id_token(&server.uri(), "issued", &nonce),
            "scope": "openid email chatgpt.tokens.use.direct"
        })))
        .mount(&server)
        .await;
    let redirect = url::Url::parse(&authorize_param(&sign_in, "redirect_uri")).unwrap();
    let address = format!("127.0.0.1:{}", redirect.port().unwrap());
    // A browser's preconnect: opened, never sent on, held open.
    let _idle = tokio::net::TcpStream::connect(&address).await.unwrap();
    // A connection reset mid-request.
    {
        use tokio::io::AsyncWriteExt as _;
        let mut broken = tokio::net::TcpStream::connect(&address).await.unwrap();
        broken.write_all(b"GET /auth/cal").await.unwrap();
        broken.set_zero_linger().unwrap();
    }
    browser_returns(&sign_in, |state| format!("code=c&state={state}")).await;

    let started = std::time::Instant::now();
    let account = sign_in.finish(Duration::from_secs(20)).await.unwrap();
    assert!(account.sharing);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_callback_from_another_sign_in_is_refused() {
    let server = MockServer::start().await;
    let sign_in = SignIn::start(&server.uri(), &HostId::generate(), Some("issued"), false)
        .await
        .unwrap();
    browser_returns(&sign_in, |_| "code=c&state=someone-elses".into()).await;
    let error = sign_in.finish(Duration::from_secs(10)).await.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Auth, "{error}");
}

#[tokio::test]
async fn a_sign_in_without_plan_consent_is_not_usable() {
    let server = MockServer::start().await;
    let sign_in = SignIn::start(&server.uri(), &HostId::generate(), Some("issued"), false)
        .await
        .unwrap();
    let nonce = authorize_param(&sign_in, "nonce");
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "access", "refresh_token": "refresh", "token_type": "Bearer",
            "id_token": id_token(&server.uri(), "issued", &nonce), "scope": "openid email"
        })))
        .mount(&server)
        .await;
    browser_returns(&sign_in, |state| format!("code=c&state={state}")).await;
    let account = sign_in.finish(Duration::from_secs(10)).await.unwrap();
    assert_eq!(
        account.client_id, "issued",
        "a saved registration is reused"
    );
    assert!(!account.sharing && !account.is_usable());
}

#[tokio::test]
async fn a_sign_in_declined_in_the_browser_is_cancelled() {
    let server = MockServer::start().await;
    let sign_in = SignIn::start(&server.uri(), &HostId::generate(), Some("issued"), false)
        .await
        .unwrap();
    browser_returns(&sign_in, |state| {
        format!("error=access_denied&error_description=The+user+said+no&state={state}")
    })
    .await;
    let error = sign_in.finish(Duration::from_secs(10)).await.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Cancelled, "{error}");
    assert!(
        error.to_string().contains("access_denied The user said no"),
        "{error}"
    );
}

#[tokio::test]
async fn a_browser_that_never_returns_times_out() {
    let server = MockServer::start().await;
    let sign_in = SignIn::start(&server.uri(), &HostId::generate(), None, false)
        .await
        .unwrap();
    let error = sign_in.finish(Duration::from_millis(50)).await.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Cancelled, "{error}");
}

/// An ID token as the token endpoint would send it; only its claims are read.
pub fn id_token(issuer: &str, audience: &str, nonce: &str) -> String {
    use base64::Engine as _;
    let claims = json!({
        "iss": issuer, "aud": audience, "sub": "user-signin", "exp": 4_000_000_000_u64,
        "nonce": nonce, "email": "ada@example.com"
    });
    let payload =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string().as_bytes());
    // `e30` is `{}`: the header and signature are never read.
    format!("e30.{payload}.signature")
}

/// The value of `name` in the sign-in's authorize URL, such as its `nonce`.
pub fn authorize_param(sign_in: &SignIn, name: &str) -> String {
    url::Url::parse(sign_in.url())
        .unwrap()
        .query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| panic!("the authorize URL has no {name}"))
}

/// Plays the browser: follows the authorize URL's redirect back to Study with `query`,
/// given the sign-in's `state`.
pub async fn browser_returns(sign_in: &SignIn, query: impl Fn(&str) -> String) {
    let callback = format!(
        "{}?{}",
        authorize_param(sign_in, "redirect_uri"),
        query(&authorize_param(sign_in, "state"))
    );
    tokio::spawn(async move {
        // A browser also asks for a favicon; Study must not take it for the callback.
        let origin = callback.split("/auth/callback").next().unwrap().to_owned();
        let _ = reqwest::get(format!("{origin}/favicon.ico")).await;
        let _ = reqwest::get(callback).await;
    });
}
