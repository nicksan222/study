//! The issuer's token endpoint: one form posted, and the tokens it answers with, for a
//! sign-in's code and for every renewal alike.

use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;

use super::TOKEN_PATH;
use super::error::PlanError;
use crate::http::{Timeouts, client};

/// How long a call to the sign-in server may take.
pub(super) const TIMEOUT: Duration = Duration::from_secs(30);

/// How long an access token lasts when the answer does not say.
const DEFAULT_LIFETIME: Duration = Duration::from_secs(3600);

/// What the token endpoint answers a code or a refresh with.
#[derive(Deserialize)]
pub(super) struct Tokens {
    pub access_token: String,
    /// The one to renew with next; OpenAI rotates it on every refresh.
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
}

impl Tokens {
    /// How long the access token lasts.
    pub fn lifetime(&self) -> Duration {
        self.expires_in
            .map_or(DEFAULT_LIFETIME, Duration::from_secs)
    }
}

/// Posts `form` to `issuer`'s token endpoint and reads its answer as `T`; a refusal is read
/// by `refused` from its status and body.
pub(super) async fn request<T: DeserializeOwned>(
    issuer: &str,
    form: &[(&str, &str)],
    refused: fn(u16, &str) -> PlanError,
) -> Result<T, PlanError> {
    let response = client(Timeouts::api(TIMEOUT))?
        .post(format!("{issuer}{TOKEN_PATH}"))
        .form(form)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(refused(status.as_u16(), &body));
    }
    serde_json::from_str(&body)
        .map_err(|error| PlanError::Answer(format!("token response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_access_token_lasts_an_hour_unless_the_answer_says() {
        let tokens: Tokens = serde_json::from_str(r#"{"access_token": "a"}"#).unwrap();
        assert_eq!(tokens.lifetime(), DEFAULT_LIFETIME);
        let tokens: Tokens =
            serde_json::from_str(r#"{"access_token": "a", "expires_in": 60}"#).unwrap();
        assert_eq!(tokens.lifetime(), Duration::from_secs(60));
    }
}
