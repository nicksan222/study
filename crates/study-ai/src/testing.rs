//! A mock of the ChatGPT plan for tests, behind the `testing` feature: one wiremock server
//! stands in for both the sign-in server and the Responses API. This crate's tests and the
//! crates above it share it, so the plan's wire format is written once.

use std::time::Duration;

use serde_json::json;
use study_core::preferences::Secret;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::ApiConfig;
use crate::chat::provider::chatgpt::{self, ChatGptConfig};
use crate::chat::{ChatGptAccount, ProviderConfig};

/// The client id the mock sign-in server issued.
pub const CLIENT_ID: &str = "issued-client";
/// The model every tier asks the mock for.
pub const MODEL: &str = "gpt-test";
/// Where the sign-in server issues and renews tokens.
pub const TOKEN_PATH: &str = chatgpt::TOKEN_PATH;
/// Where the sign-in server ends a sign-in.
pub const REVOKE_PATH: &str = chatgpt::REVOKE_PATH;
/// Where the Responses API answers prompts.
pub const RESPONSES_PATH: &str = chatgpt::RESPONSES_PATH;

/// A signed-in account sharing its plan, with a subject of its own: live sessions are
/// shared per account across the whole test binary.
pub fn account(refresh_token: &str) -> ChatGptAccount {
    ChatGptAccount {
        client_id: CLIENT_ID.into(),
        subject: format!("user-{}", uuid::Uuid::new_v4()),
        email: Some("ada@example.com".into()),
        sharing: true,
        refresh_token: Secret::parse(refresh_token),
    }
}

/// The [`MODEL`] on the plan at `server`, which is also its sign-in server.
pub fn plan(server: &MockServer, account: Option<ChatGptAccount>) -> ProviderConfig {
    ProviderConfig::ChatGpt(Box::new(ChatGptConfig {
        api: ApiConfig {
            base_url: server.uri(),
            model: MODEL.into(),
            timeout: Duration::from_secs(10),
        },
        issuer: server.uri(),
        account,
    }))
}

/// A Responses event stream whose answer is `text`.
pub fn answer(text: &str) -> ResponseTemplate {
    stream(&[
        json!({"type": "response.output_text.delta", "delta": text}),
        json!({"type": "response.completed", "response": {
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
            "usage": {"input_tokens": 5, "output_tokens": 1, "total_tokens": 6}
        }}),
    ])
}

/// A Responses event stream whose answer stopped after `text`, for `reason` (such as
/// `max_output_tokens` or `content_filter`).
pub fn incomplete(text: &str, reason: &str) -> ResponseTemplate {
    stream(&[
        json!({"type": "response.output_text.delta", "delta": text}),
        json!({"type": "response.incomplete", "response": {
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
            "incomplete_details": {"reason": reason}
        }}),
    ])
}

/// `events` as a server-sent event stream.
fn stream(events: &[serde_json::Value]) -> ResponseTemplate {
    let body: String = events
        .iter()
        .map(|event| format!("event: {}\ndata: {event}\n\n", event["type"]))
        .collect();
    ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_string(body)
}

/// The token endpoint renewing a sign-in: a new access and refresh token, with the plan
/// shared.
pub fn tokens(access: &str, refresh: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({
        "access_token": access, "refresh_token": refresh, "token_type": "Bearer",
        "expires_in": 3600, "scope": "openid chatgpt.tokens.use.direct"
    }))
}

/// Makes `server` renew every sign-in, for tests about what comes after it.
async fn renew_tokens(server: &MockServer) {
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(tokens("access", "refresh"))
        .mount(server)
        .await;
}

/// A mock plan that is signed in: its server, renewing tokens, and the [`plan`] on it.
pub async fn signed_in() -> (MockServer, ProviderConfig) {
    let server = MockServer::start().await;
    renew_tokens(&server).await;
    let plan = plan(&server, Some(account("refresh")));
    (server, plan)
}
