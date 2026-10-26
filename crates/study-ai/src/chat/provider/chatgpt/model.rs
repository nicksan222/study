//! `PlanModel`: a Rig model that sends each request to the Responses API on the user's plan.
//!
//! Rig turns the agent's request into a Responses body; this model then fits it to what
//! the plan accepts (streamed, never stored, instructions at the top, no sampling or
//! output limits) and reads the streamed answer back whole. Agents in Study want one whole
//! answer, so `stream` also waits for it and hands it over in one piece.

use std::sync::Arc;

use futures::StreamExt as _;
use rig_core::completion::{
    AssistantContent, CompletionError, CompletionModel, CompletionRequest, CompletionResponse,
    Usage,
};
use rig_core::providers::openai::responses_api::{
    CompletionRequest as ResponsesRequest, ResponsesRequestParams, SystemInstructionsPlacement,
};
use rig_core::streaming::{RawStreamingChoice, StreamFinal, StreamingCompletionResponse};
use serde::Deserialize;

use super::error::{self, IncompleteReason, PlanError};
use super::session::Session;
use super::{NAME, RESPONSES_PATH};
use crate::ApiConfig;
use crate::http::{Timeouts, client};

#[derive(Clone)]
pub(crate) struct PlanModel {
    api: ApiConfig,
    /// `None` when nobody is signed in: every request then fails as a setup problem.
    session: Option<Arc<Session>>,
}

impl PlanModel {
    pub(crate) fn new(api: ApiConfig, session: Option<Arc<Session>>) -> Self {
        Self { api, session }
    }

    /// The Responses body for `request`, cut down to what the plan accepts.
    fn body(&self, request: CompletionRequest) -> Result<ResponsesRequest, CompletionError> {
        let mut body = ResponsesRequest::try_from(ResponsesRequestParams {
            model: self.api.model.clone(),
            request,
            // The plan rejects system items in `input`.
            system_instructions_placement: SystemInstructionsPlacement::AllInstructions,
        })?;
        body.stream = Some(true);
        body.temperature = None;
        body.max_output_tokens = None;
        let extra = &mut body.additional_parameters;
        extra.store = Some(false);
        extra.background = None;
        extra.metadata.clear();
        extra.previous_response_id = None;
        extra.prompt_cache_retention = None;
        extra.top_p = None;
        extra.truncation = None;
        extra.user = None;
        Ok(body)
    }

    async fn answer(&self, request: CompletionRequest) -> Result<Answer, CompletionError> {
        let body = self.body(request)?;
        self.send(&body).await.map_err(|error| {
            CompletionError::RequestError(Box::new(crate::chat::Error::Plan(error)))
        })
    }

    /// Sends `body` with the account's token. A token the API refuses is renewed once, as
    /// OpenAI recommends, before the refusal counts.
    async fn send(&self, body: &ResponsesRequest) -> Result<Answer, PlanError> {
        let session = self.session.as_ref().ok_or(PlanError::SignedOut)?;
        let client = client(Timeouts::api(self.api.timeout))?;
        let url = format!(
            "{}{RESPONSES_PATH}",
            self.api.base_url.trim_end_matches('/')
        );
        let mut retried = false;
        loop {
            let token = session.token().await?;
            let response = client
                .post(&url)
                .bearer_auth(token.expose())
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .json(body)
                .send()
                .await?;
            let status = response.status();
            let text = response.text().await?;
            if status == reqwest::StatusCode::UNAUTHORIZED && !retried {
                retried = true;
                session.refused(&token).await;
                continue;
            }
            if !status.is_success() {
                return Err(error::from_api(status.as_u16(), &text));
            }
            return read_events(&text);
        }
    }
}

/// A whole answer from the stream.
struct Answer {
    text: String,
    usage: Usage,
}

/// One server-sent event of a Responses stream, as far as Study reads it.
#[derive(Deserialize)]
struct Event {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    delta: Option<String>,
    #[serde(default)]
    response: Option<ResponseBody>,
    /// On an `error` event.
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Default, Deserialize)]
struct ResponseBody {
    #[serde(default)]
    output: Vec<OutputItem>,
    #[serde(default)]
    usage: Option<WireUsage>,
    #[serde(default)]
    error: Option<serde_json::Value>,
    /// On a `response.incomplete` event: why the answer stopped early.
    #[serde(default)]
    incomplete_details: Option<IncompleteDetails>,
}

#[derive(Deserialize)]
struct IncompleteDetails {
    #[serde(default)]
    reason: Option<IncompleteReason>,
}

#[derive(Deserialize)]
struct OutputItem {
    #[serde(default)]
    content: Vec<ContentPart>,
}

#[derive(Deserialize)]
struct ContentPart {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct WireUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    total_tokens: u64,
}

/// The answer in a Responses event stream: the text of the final response, or the text
/// deltas when the final event leaves its output out. An answer that stopped early is an
/// error, never a finished answer.
fn read_events(body: &str) -> Result<Answer, PlanError> {
    let mut deltas = String::new();
    for line in body.lines() {
        let Some(data) = line.strip_prefix("data:").map(str::trim) else {
            continue;
        };
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let event = match serde_json::from_str::<Event>(data) {
            Ok(event) => event,
            Err(error) => {
                // Only where it failed: the error's own text may quote the answer.
                tracing::warn!(
                    category = ?error.classify(),
                    column = error.column(),
                    "skipped a Responses event that could not be read"
                );
                continue;
            }
        };
        match event.kind.as_str() {
            "response.output_text.delta" => deltas.push_str(event.delta.as_deref().unwrap_or("")),
            "response.completed" => {
                return Ok(finished(event.response.unwrap_or_default(), deltas));
            }
            // Cut off by the output cap or a filter: what came is not the whole answer.
            "response.incomplete" => {
                let reason = event
                    .response
                    .and_then(|response| response.incomplete_details)
                    .and_then(|details| details.reason)
                    .unwrap_or_else(|| IncompleteReason::Other(String::new()));
                return Err(PlanError::Incomplete { reason });
            }
            "response.failed" => {
                let error = event.response.and_then(|response| response.error);
                return Err(refused_in_stream(error.unwrap_or_default()));
            }
            "error" => {
                let error = serde_json::json!({ "code": event.code, "message": event.message });
                return Err(refused_in_stream(error));
            }
            _ => {}
        }
    }
    Err(PlanError::Answer(
        "the stream ended before the answer did".into(),
    ))
}

/// The answer in the final response: its output text, or the `deltas` streamed before it
/// when it leaves its output out.
fn finished(response: ResponseBody, deltas: String) -> Answer {
    let text: String = response
        .output
        .iter()
        .flat_map(|item| &item.content)
        .filter(|part| part.kind == "output_text")
        .filter_map(|part| part.text.as_deref())
        .collect();
    let usage = response.usage.map_or_else(Usage::new, |usage| Usage {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
        ..Usage::new()
    });
    Answer {
        text: if text.is_empty() { deltas } else { text },
        usage,
    }
}

/// A refusal sent inside a stream that began fine, read like the body of a failed request.
/// The stream's own status was 200, so it stands in as 502: a refusal with no code it
/// knows counts as a server failure that may pass.
fn refused_in_stream(error: serde_json::Value) -> PlanError {
    error::from_api(502, &serde_json::json!({ "error": error }).to_string())
}

impl CompletionModel for PlanModel {
    async fn completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, CompletionError> {
        let answer = self.answer(request).await?;
        Ok(CompletionResponse::new(
            vec![AssistantContent::text(answer.text)],
            answer.usage,
            NAME,
        ))
    }

    async fn stream(
        &self,
        request: CompletionRequest,
    ) -> Result<StreamingCompletionResponse, CompletionError> {
        let answer = self.answer(request).await?;
        let parts = vec![
            Ok(RawStreamingChoice::Message(answer.text)),
            Ok(RawStreamingChoice::FinalResponse(StreamFinal::new(
                NAME,
                answer.usage,
            ))),
        ];
        Ok(StreamingCompletionResponse::stream(
            NAME,
            futures::stream::iter(parts).boxed(),
        ))
    }
}

impl std::fmt::Debug for PlanModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlanModel")
            .field("model", &self.api.model)
            .field("signed_in", &self.session.is_some())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use study_core::{Classify as _, ErrorKind};

    use super::*;
    use crate::chat::Tier;
    use crate::chat::provider::chatgpt::defaults;

    fn events(events: &[serde_json::Value]) -> String {
        events
            .iter()
            .map(|event| format!("event: {}\ndata: {event}\n\n", event["type"]))
            .collect()
    }

    #[test]
    fn the_answer_is_the_final_text_or_else_the_deltas() {
        let whole = events(&[
            serde_json::json!({"type": "response.output_text.delta", "delta": "Hel"}),
            serde_json::json!({"type": "response.completed", "response": {
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "Hello"}]}],
                "usage": {"input_tokens": 3, "output_tokens": 1, "total_tokens": 4}
            }}),
        ]);
        let answer = read_events(&whole).unwrap();
        assert_eq!(answer.text, "Hello");
        assert_eq!(answer.usage.total_tokens, 4);

        let deltas = events(&[
            serde_json::json!({"type": "response.output_text.delta", "delta": "Hel"}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "lo"}),
            serde_json::json!({"type": "response.completed", "response": {"output": []}}),
        ]);
        assert_eq!(read_events(&deltas).unwrap().text, "Hello");
    }

    #[test]
    fn a_failed_or_cut_stream_is_an_error_of_its_kind() {
        let limit = events(
            &[serde_json::json!({"type": "response.failed", "response": {
                "error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "m"}
            }})],
        );
        assert!(matches!(read_events(&limit), Err(PlanError::UsageLimit)));
        let error = events(&[serde_json::json!({
            "type": "error", "code": "subscription_sharing_invalid_user", "message": "m"
        })]);
        assert!(matches!(read_events(&error), Err(PlanError::Revoked)));
        let cut =
            events(&[serde_json::json!({"type": "response.output_text.delta", "delta": "x"})]);
        assert_eq!(
            read_events(&cut).err().unwrap().kind(),
            ErrorKind::Transient
        );
    }

    #[test]
    fn an_answer_that_stopped_early_is_not_finished() {
        let incomplete = |reason: &str| {
            events(&[
                serde_json::json!({"type": "response.output_text.delta", "delta": "Half"}),
                serde_json::json!({"type": "response.incomplete", "response": {
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "Half"}]}],
                    "incomplete_details": {"reason": reason}
                }}),
            ])
        };
        let capped = read_events(&incomplete("max_output_tokens")).err().unwrap();
        assert_eq!(capped.kind(), ErrorKind::Transient);
        let filtered = read_events(&incomplete("content_filter")).err().unwrap();
        assert_eq!(filtered.kind(), ErrorKind::InvalidInput);
    }

    #[test]
    fn an_unreadable_event_is_skipped_with_a_warning_that_leaves_its_data_out() {
        #[derive(Clone, Default)]
        struct Log(Arc<std::sync::Mutex<Vec<u8>>>);
        impl std::io::Write for Log {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let log = Log::default();
        let writer = log.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(move || writer.clone())
            .finish();
        let _default = tracing::subscriber::set_default(subscriber);

        let body = events(&[
            serde_json::json!({"type": "response.completed", "response": "private words"}),
            serde_json::json!({"type": "response.completed", "response": {"output": []}}),
        ]);
        assert!(read_events(&body).is_ok());

        let log = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
        assert!(log.contains("WARN"), "{log}");
        assert!(!log.contains("private words"), "{log}");
    }

    #[test]
    fn why_an_answer_stopped_is_read_into_its_reason() {
        let stopped = |details: serde_json::Value| {
            let body = events(&[
                serde_json::json!({"type": "response.incomplete", "response": {
                    "incomplete_details": details
                }}),
            ]);
            match read_events(&body) {
                Err(PlanError::Incomplete { reason }) => reason,
                other => panic!("{:?}", other.err()),
            }
        };
        use IncompleteReason::{ContentFilter, MaxOutputTokens, Other};
        let capped = stopped(serde_json::json!({"reason": "max_output_tokens"}));
        assert_eq!(capped, MaxOutputTokens);
        let filtered = stopped(serde_json::json!({"reason": "content_filter"}));
        assert_eq!(filtered, ContentFilter);
        let other = stopped(serde_json::json!({"reason": "server_busy"}));
        assert_eq!(other, Other("server_busy".into()));
        assert_eq!(stopped(serde_json::json!({})), Other(String::new()));
    }

    #[test]
    fn the_body_is_fitted_to_what_the_plan_accepts() {
        let model = PlanModel::new(defaults(Tier::Tiny), None);
        let request = model
            .completion_request("hi")
            .preamble("Be brief.".into())
            .temperature(0.2)
            .max_tokens(100)
            .build();
        let body = serde_json::to_value(model.body(request).unwrap()).unwrap();
        assert_eq!(body["model"], "gpt-6-luna");
        assert_eq!(body["stream"], true);
        assert_eq!(body["store"], false);
        assert_eq!(body["instructions"], "Be brief.");
        for dropped in ["temperature", "max_output_tokens", "metadata", "top_p"] {
            assert!(
                body.get(dropped).is_none_or(serde_json::Value::is_null),
                "{dropped}: {body}"
            );
        }
    }

    #[test]
    fn a_model_without_an_account_fails_as_setup() {
        let model = PlanModel::new(defaults(Tier::Tiny), None);
        let request = model.completion_request("hi").build();
        let body = model.body(request).expect("a plain prompt converts");
        let error = futures::executor::block_on(model.send(&body))
            .err()
            .unwrap();
        assert_eq!(error.kind(), ErrorKind::Config);
    }
}
