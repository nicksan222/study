//! [`SignIn`]: signing in to ChatGPT in the user's browser.
//!
//! OpenID Connect with PKCE. Study listens once on a loopback port, opens the authorize URL
//! in the browser, and exchanges the code the browser brings back for tokens. The ID token
//! comes straight from the token endpoint over TLS, so its issuer, audience, nonce and expiry
//! are checked and its signature is not (OpenID Connect Core 3.1.3.7).

use std::time::{Duration, SystemTime, UNIX_EPOCH};
use study_localization::{Locale, Message, text};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures::StreamExt as _;
use futures::stream::FuturesUnordered;
use serde::Deserialize;
use sha2::{Digest as _, Sha256};
use study_core::preferences::Secret;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use url::Url;

use super::account::{ChatGptAccount, HostId};
use super::error::{self, PlanError};
use super::tokens::{self, Tokens};
use super::{API_BASE, AUTHORIZE_PATH, PLAN_SCOPE, SCOPE, session};

/// The client id that asks OpenAI to register Study for an account it has not seen.
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
/// How OpenAI names Study on the consent page and in the user's connected apps.
const APP_NAME: &str = "Study";
/// The most of a browser request Study reads; the callback is one short line.
const MAX_REQUEST: usize = 16 * 1024;
/// How long a browser connection has to send its request before it is dropped.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// The loopback path OpenAI sends the browser back to; only the port may change.
const CALLBACK_PATH: &str = "/auth/callback";

/// A sign-in waiting for the browser. Open [`Self::url`], then await [`Self::finish`].
pub struct SignIn {
    url: String,
    issuer: String,
    listener: TcpListener,
    redirect_uri: String,
    /// The client id the authorize URL named: a saved registration, or the dynamic one.
    client_id: String,
    verifier: String,
    state: String,
    nonce: String,
}

impl std::fmt::Debug for SignIn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SignIn")
            .field("redirect_uri", &self.redirect_uri)
            .finish_non_exhaustive()
    }
}

impl SignIn {
    /// Starts listening for the browser and builds the authorize URL. `client_id` is the
    /// registration from an earlier sign-in on this computer, if any. `reconsent` asks the
    /// user again, for one who first declined to share their plan.
    pub async fn start(
        issuer: &str,
        host: &HostId,
        client_id: Option<&str>,
        reconsent: bool,
    ) -> Result<Self, PlanError> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let redirect_uri = format!(
            "http://127.0.0.1:{}{CALLBACK_PATH}",
            listener.local_addr()?.port()
        );
        let verifier = random_token();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_token();
        let nonce = random_token();
        let client_id = client_id.unwrap_or(DYNAMIC_CLIENT).to_owned();

        let mut url = Url::parse(&format!("{issuer}{AUTHORIZE_PATH}"))
            .map_err(|_| PlanError::BadIdentity("the sign-in address is not a URL"))?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("response_type", "code")
                .append_pair("client_id", &client_id)
                .append_pair("redirect_uri", &redirect_uri)
                .append_pair("scope", SCOPE)
                .append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256")
                .append_pair("state", &state)
                .append_pair("nonce", &nonce)
                .append_pair("resource", API_BASE)
                .append_pair("ext_agent_host_id", host.as_str());
            if client_id == DYNAMIC_CLIENT {
                query.append_pair("agent_name_hint", APP_NAME);
            }
            if reconsent {
                query.append_pair("force_reconsent", "true");
            }
        }
        Ok(Self {
            url: url.into(),
            issuer: issuer.to_owned(),
            listener,
            redirect_uri,
            client_id,
            verifier,
            state,
            nonce,
        })
    }

    /// The page to open in the browser.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Waits up to `timeout` for the browser, then exchanges its code for the account.
    pub async fn finish(self, timeout: Duration) -> Result<ChatGptAccount, PlanError> {
        let callback = tokio::time::timeout(timeout, self.callback())
            .await
            .map_err(|_| PlanError::SignInTimeout)??;
        let client_id = callback.client_id.unwrap_or_else(|| self.client_id.clone());
        if client_id == DYNAMIC_CLIENT {
            return Err(PlanError::BadIdentity("OpenAI issued no client id"));
        }
        let tokens = self.exchange(&client_id, &callback.code).await?;
        let identity = verify_identity(&tokens.id_token, &self.issuer, &client_id, &self.nonce)?;
        let sharing = tokens
            .scope
            .as_deref()
            .is_some_and(|scope| scope.split_whitespace().any(|s| s == PLAN_SCOPE));
        let account = ChatGptAccount {
            client_id,
            subject: identity.sub,
            email: identity.email,
            sharing,
            refresh_token: tokens
                .tokens
                .refresh_token
                .as_deref()
                .and_then(Secret::parse),
        };
        // A session from an earlier sign-in holds tokens this one replaced.
        session::forget(&account.subject);
        if let Some(access) = Secret::parse(&tokens.tokens.access_token) {
            session::Session::signed_in(&self.issuer, &account, access, tokens.tokens.lifetime());
        }
        Ok(account)
    }

    /// Answers browser requests until the callback arrives, and returns what it carried.
    /// Connections are read side by side: a browser opens some it never sends on, and one
    /// may break, and neither may hold up or end the sign-in.
    async fn callback(&self) -> Result<Callback, PlanError> {
        let mut reading = FuturesUnordered::new();
        loop {
            tokio::select! {
                accepted = self.listener.accept() => {
                    let (stream, _) = accepted?;
                    reading.push(read_request(stream));
                }
                Some(read) = reading.next(), if !reading.is_empty() => {
                    let Some((stream, path)) = read else {
                        continue;
                    };
                    if let Some(finished) = self.answer(stream, &path).await {
                        return finished;
                    }
                }
            }
        }
    }

    /// Answers the request for `path` on `stream`: the sign-in's end when it is the callback,
    /// `None` for anything else the browser asks for.
    async fn answer(
        &self,
        mut stream: TcpStream,
        path: &str,
    ) -> Option<Result<Callback, PlanError>> {
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{path}")) else {
            respond(&mut stream, "400 Bad Request", "").await;
            return None;
        };
        if url.path() != CALLBACK_PATH {
            respond(&mut stream, "404 Not Found", "").await;
            return None;
        }
        let get = |name: &str| query_value(&url, name);
        let failed = browser_page(Message::LlmChatGptBrowserFailed);
        if get("state").as_deref() != Some(self.state.as_str()) {
            respond(&mut stream, "400 Bad Request", &failed).await;
            return Some(Err(PlanError::SignInMismatch));
        }
        if let Some(error) = get("error") {
            respond(&mut stream, "200 OK", &failed).await;
            let description = get("error_description").unwrap_or_default();
            return Some(Err(PlanError::SignInDeclined(
                format!("{error} {description}").trim().to_owned(),
            )));
        }
        let Some(code) = get("code") else {
            respond(&mut stream, "400 Bad Request", &failed).await;
            return Some(Err(PlanError::SignInDeclined("no code".into())));
        };
        respond(
            &mut stream,
            "200 OK",
            &browser_page(Message::LlmChatGptBrowserDone),
        )
        .await;
        Some(Ok(Callback {
            code,
            client_id: get("client_id"),
        }))
    }

    async fn exchange(&self, client_id: &str, code: &str) -> Result<CodeTokens, PlanError> {
        let form = [
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", self.verifier.as_str()),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("resource", API_BASE),
        ];
        tokens::request(&self.issuer, &form, error::from_api).await
    }
}

struct Callback {
    code: String,
    /// The client id OpenAI issued, on a first sign-in.
    client_id: Option<String>,
}

/// What the token endpoint answers a sign-in's code with: the tokens a renewal also gets,
/// and who signed in with what they granted.
#[derive(Deserialize)]
struct CodeTokens {
    #[serde(flatten)]
    tokens: Tokens,
    id_token: String,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct Identity {
    iss: String,
    aud: Audience,
    sub: String,
    exp: u64,
    nonce: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

/// Who signed in, from an ID token the token endpoint sent over TLS.
fn verify_identity(
    id_token: &str,
    issuer: &str,
    client_id: &str,
    nonce: &str,
) -> Result<Identity, PlanError> {
    let payload = id_token
        .split('.')
        .nth(1)
        .ok_or(PlanError::BadIdentity("the ID token is not a JWT"))?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| PlanError::BadIdentity("the ID token is not base64"))?;
    let identity: Identity = serde_json::from_slice(&bytes)
        .map_err(|_| PlanError::BadIdentity("the ID token lacks its claims"))?;
    if identity.iss.trim_end_matches('/') != issuer.trim_end_matches('/') {
        return Err(PlanError::BadIdentity(
            "the ID token is from another issuer",
        ));
    }
    let for_study = match &identity.aud {
        Audience::One(aud) => aud == client_id,
        Audience::Many(auds) => auds.iter().any(|aud| aud == client_id),
    };
    if !for_study {
        return Err(PlanError::BadIdentity("the ID token is for another app"));
    }
    if identity.nonce.as_deref() != Some(nonce) {
        return Err(PlanError::BadIdentity(
            "the ID token is from another sign-in",
        ));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    if identity.exp <= now {
        return Err(PlanError::BadIdentity("the ID token has expired"));
    }
    Ok(identity)
}

/// 32 random bytes, URL-safe: a PKCE verifier, `state`, or `nonce`.
fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

/// The value of `name` in `url`'s query.
fn query_value(url: &Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

/// `stream` and the path of the HTTP request on it, such as `/auth/callback?code=…`; `None`
/// for a connection that broke or sent no request within [`REQUEST_TIMEOUT`].
async fn read_request(mut stream: TcpStream) -> Option<(TcpStream, String)> {
    let path = tokio::time::timeout(REQUEST_TIMEOUT, read_request_path(&mut stream)).await;
    match path {
        Ok(Ok(path)) => Some((stream, path)),
        Ok(Err(error)) => {
            tracing::debug!(%error, "a browser connection broke; ignored");
            None
        }
        Err(_) => None,
    }
}

/// The path of the HTTP request on `stream`.
async fn read_request_path(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut request = Vec::new();
    let mut chunk = [0; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") && request.len() < MAX_REQUEST {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
    }
    let head = String::from_utf8_lossy(&request);
    Ok(head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_owned())
}

async fn respond(stream: &mut TcpStream, status: &str, page: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    // The browser leaving early changes nothing about the sign-in.
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// The page the browser tab shows after the sign-in, in every language Study speaks: the
/// tab knows nothing of the app's language setting.
fn browser_page(message: Message) -> String {
    let lines: Vec<&str> = Locale::ALL
        .iter()
        .map(|&locale| text(locale, message))
        .collect();
    format!(
        "<!doctype html><meta charset=utf-8><title>Study</title>\
<p style=\"font-family:sans-serif\">{}</p>",
        lines.join("<br>")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id_token(claims: serde_json::Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
        )
    }

    fn claims(aud: &str, nonce: &str) -> serde_json::Value {
        serde_json::json!({
            "iss": "https://auth.example", "aud": aud, "sub": "user-1",
            "exp": 4_000_000_000_u64, "nonce": nonce, "email": "ada@example.com"
        })
    }

    #[test]
    fn an_id_token_must_be_for_this_app_and_this_sign_in() {
        let token = id_token(claims("issued", "n1"));
        let identity = verify_identity(&token, "https://auth.example", "issued", "n1").unwrap();
        assert_eq!(identity.sub, "user-1");
        assert!(verify_identity(&token, "https://auth.example", "other", "n1").is_err());
        assert!(verify_identity(&token, "https://auth.example", "issued", "n2").is_err());
        assert!(verify_identity(&token, "https://evil.example", "issued", "n1").is_err());
        let mut expired = claims("issued", "n1");
        expired["exp"] = 1.into();
        assert!(
            verify_identity(&id_token(expired), "https://auth.example", "issued", "n1").is_err()
        );
    }

    #[tokio::test]
    async fn the_authorize_url_registers_study_the_first_time_only() {
        let host = HostId::generate();
        let first = SignIn::start("https://auth.example", &host, None, false)
            .await
            .unwrap();
        let url = Url::parse(first.url()).unwrap();
        assert_eq!(url.path(), AUTHORIZE_PATH);
        assert_eq!(
            query_value(&url, "client_id").as_deref(),
            Some(DYNAMIC_CLIENT)
        );
        assert_eq!(
            query_value(&url, "agent_name_hint").as_deref(),
            Some(APP_NAME)
        );
        assert_eq!(
            query_value(&url, "ext_agent_host_id").as_deref(),
            Some(host.as_str())
        );
        assert_eq!(
            query_value(&url, "code_challenge_method").as_deref(),
            Some("S256")
        );
        assert_eq!(query_value(&url, "resource").as_deref(), Some(API_BASE));
        assert!(query_value(&url, "scope").unwrap().contains(PLAN_SCOPE));
        assert!(
            query_value(&url, "redirect_uri")
                .unwrap()
                .starts_with("http://127.0.0.1:")
                && query_value(&url, "redirect_uri")
                    .unwrap()
                    .ends_with(CALLBACK_PATH)
        );
        assert_eq!(query_value(&url, "force_reconsent"), None);

        let again = SignIn::start("https://auth.example", &host, Some("issued"), true)
            .await
            .unwrap();
        let url = Url::parse(again.url()).unwrap();
        assert_eq!(query_value(&url, "client_id").as_deref(), Some("issued"));
        assert_eq!(query_value(&url, "agent_name_hint"), None);
        assert_eq!(
            query_value(&url, "force_reconsent").as_deref(),
            Some("true")
        );
    }
}
