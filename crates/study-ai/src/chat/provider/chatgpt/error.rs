//! [`PlanError`]: what the ChatGPT plan API and the sign-in refuse, read from the typed
//! `error.code` OpenAI sends, never from its message.

use serde::Deserialize;
use study_core::{Classify, ErrorKind};

/// What the plan API or the sign-in refused, or why its answer could not be used.
#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("nobody is signed in to ChatGPT, or the plan is not shared with Study")]
    SignedOut,
    #[error("the ChatGPT plan's usage limit is reached; see Usage in ChatGPT's settings")]
    UsageLimit,
    #[error("ChatGPT disconnected Study; sign in again")]
    Revoked,
    #[error("the ChatGPT sign-in expired; sign in again")]
    SignInExpired,
    #[error("this ChatGPT account cannot use its plan in other apps")]
    NotEligible,
    #[error("the ChatGPT plan does not support part of this request ({param})")]
    Unsupported { param: String },
    #[error("the ChatGPT plan refused the request ({status}): {message}")]
    Refused {
        status: u16,
        code: Option<String>,
        message: String,
    },
    #[error("the ChatGPT answer could not be read: {0}")]
    Answer(String),
    /// The model stopped before its answer was whole, such as at its output cap.
    #[error("the ChatGPT answer stopped early ({reason})")]
    Incomplete { reason: IncompleteReason },
    #[error("the sign-in did not come back from the browser in time")]
    SignInTimeout,
    #[error("the sign-in was declined or failed in the browser: {0}")]
    SignInDeclined(String),
    #[error("the sign-in answer does not belong to this sign-in")]
    SignInMismatch,
    #[error("the sign-in returned an unusable identity: {0}")]
    BadIdentity(&'static str),
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Classify for PlanError {
    fn kind(&self) -> ErrorKind {
        match self {
            // The user fixes these in Settings, and the work then runs again.
            Self::SignedOut | Self::Revoked | Self::SignInExpired | Self::NotEligible => {
                ErrorKind::Config
            }
            Self::UsageLimit => ErrorKind::RateLimited,
            // The same request would be refused again.
            Self::Unsupported { .. } => ErrorKind::Unsupported,
            Self::Refused { status, .. } => crate::error::kind_of_status(*status),
            Self::Answer(_) => ErrorKind::Transient,
            // A filter refuses the same input again; an answer cut short may fit next time.
            Self::Incomplete {
                reason: IncompleteReason::ContentFilter,
            } => ErrorKind::InvalidInput,
            Self::Incomplete { .. } => ErrorKind::Transient,
            Self::SignInTimeout | Self::SignInDeclined(_) => ErrorKind::Cancelled,
            Self::SignInMismatch | Self::BadIdentity(_) => ErrorKind::Auth,
            Self::Http(error) => crate::error::kind_of_http(error),
            Self::Io(error) => Classify::kind(error),
        }
    }
}

/// Why the model stopped before its answer was whole: `incomplete_details.reason`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IncompleteReason {
    /// It reached its output cap.
    MaxOutputTokens,
    /// A content filter stopped it.
    ContentFilter,
    /// A reason Study does not know, as sent; empty when none was given.
    #[serde(untagged)]
    Other(String),
}

impl std::fmt::Display for IncompleteReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::MaxOutputTokens => "max_output_tokens",
            Self::ContentFilter => "content_filter",
            Self::Other(reason) => reason,
        })
    }
}

/// OpenAI's error body: `{"error": {"code", "message", "param"}}` from the API, or
/// `{"error": "invalid_grant", "error_description"}` from the token endpoint.
#[derive(Deserialize)]
struct Body {
    error: ErrorField,
    #[serde(default)]
    error_description: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ErrorField {
    Object {
        #[serde(default)]
        code: Option<String>,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        param: Option<String>,
    },
    Code(String),
}

/// What a failed plan API call means, from its status and body.
pub(super) fn from_api(status: u16, body: &str) -> PlanError {
    let (code, message, param) = match serde_json::from_str::<Body>(body) {
        Ok(Body {
            error:
                ErrorField::Object {
                    code,
                    message,
                    param,
                },
            ..
        }) => (code, message, param),
        Ok(Body {
            error: ErrorField::Code(code),
            error_description,
        }) => (Some(code), error_description, None),
        Err(_) => (None, None, None),
    };
    match code.as_deref() {
        Some("subscription_sharing_usage_limit_exceeded") => PlanError::UsageLimit,
        Some("subscription_sharing_invalid_user") => PlanError::Revoked,
        Some("subscription_sharing_user_not_eligible") => PlanError::NotEligible,
        Some("subscription_sharing_unsupported_capability") => PlanError::Unsupported {
            param: param.unwrap_or_default(),
        },
        _ => PlanError::Refused {
            status,
            code,
            message: message.unwrap_or_else(|| body.chars().take(200).collect()),
        },
    }
}

/// What a failed token refresh means: a dead refresh token needs a new sign-in, anything
/// else may pass.
pub(super) fn from_refresh(status: u16, body: &str) -> PlanError {
    match from_api(status, body) {
        PlanError::Refused {
            code: Some(code), ..
        } if matches!(
            code.as_str(),
            "invalid_grant"
                | "invalid_refresh_token"
                | "token_expired"
                | "refresh_token_expired"
                | "refresh_token_invalidated"
                | "refresh_token_reused"
        ) =>
        {
            PlanError::SignInExpired
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn api(status: u16, code: &str) -> PlanError {
        from_api(
            status,
            &format!(r#"{{"error": {{"code": "{code}", "message": "m", "param": "tools"}}}}"#),
        )
    }

    #[test]
    fn plan_errors_are_read_from_their_code() {
        assert_eq!(
            api(429, "subscription_sharing_usage_limit_exceeded").kind(),
            ErrorKind::RateLimited
        );
        assert_eq!(
            api(401, "subscription_sharing_invalid_user").kind(),
            ErrorKind::Config
        );
        assert_eq!(
            api(403, "subscription_sharing_user_not_eligible").kind(),
            ErrorKind::Config
        );
        assert!(matches!(
            api(400, "subscription_sharing_unsupported_capability"),
            PlanError::Unsupported { param } if param == "tools"
        ));
        assert_eq!(api(503, "overloaded").kind(), ErrorKind::Transient);
        assert_eq!(from_api(500, "not json").kind(), ErrorKind::Transient);
    }

    #[test]
    fn a_dead_refresh_token_needs_a_new_sign_in() {
        let body = r#"{"error": "refresh_token_reused", "error_description": "used"}"#;
        assert!(matches!(from_refresh(400, body), PlanError::SignInExpired));
        assert!(matches!(
            from_refresh(503, r#"{"error": "temporarily_unavailable"}"#),
            PlanError::Refused { status: 503, .. }
        ));
    }
}
