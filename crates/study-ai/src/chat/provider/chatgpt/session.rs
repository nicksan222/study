//! `Session`: one signed-in account's live access token, shared by every model on it.
//!
//! Access tokens last an hour and live only in memory. Renewing one also replaces the
//! refresh token, and the old one stops working, so renewals for an account run one at a
//! time and each new refresh token is saved before the access token it came with is used.
//! A lost refresh token would sign the user out at the next launch.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use study_core::db::Store;
use study_core::preferences::Secret;

use super::REVOKE_PATH;
use super::account::{ChatGptAccount, ChatGptPreferences};
use super::error::{self, PlanError};
use super::tokens::{self, Tokens};
use crate::http::{Timeouts, client};

/// Renew this long before the access token expires, so a request never starts with one
/// about to lapse.
const RENEW_MARGIN: Duration = Duration::from_secs(300);
/// Requests a sign-out sends before it gives up on reaching OpenAI.
const REVOKE_ATTEMPTS: u32 = 3;

/// One account's live access token, shared by every model on it.
pub(crate) struct Session {
    issuer: String,
    state: tokio::sync::Mutex<State>,
}

struct State {
    account: ChatGptAccount,
    access: Option<(Secret, Instant)>,
}

/// Every live session, by account subject.
fn sessions() -> MutexGuard<'static, HashMap<String, Arc<Session>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
    lock(SESSIONS.get_or_init(Mutex::default))
}

/// Where renewed refresh tokens are saved, once the app says.
fn saved_in() -> MutexGuard<'static, Option<Store>> {
    static STORE: OnceLock<Mutex<Option<Store>>> = OnceLock::new();
    lock(STORE.get_or_init(Mutex::default))
}

/// These maps stay consistent even if a holder panicked, so a poisoned lock is still used.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Saves renewed refresh tokens into `store` from now on. The app calls this once at
/// start; without it, renewals live only in memory, which suits tests.
pub fn remember_in(store: Store) {
    *saved_in() = Some(store);
}

/// Drops the live session of the account `subject`, as signing out does.
pub fn forget(subject: &str) {
    sessions().remove(subject);
}

impl Session {
    /// The live session for `account`. One already running keeps its newer tokens, unless
    /// `account` is a new sign-in (another client id or refresh token that is not the one
    /// the session started from).
    pub(crate) fn shared(issuer: &str, account: &ChatGptAccount) -> Arc<Self> {
        let mut sessions = sessions();
        if let Some(session) = sessions.get(&account.subject)
            && session.issuer == issuer
            && session.started_from(account)
        {
            return session.clone();
        }
        let session = Self::new(issuer, account, None);
        sessions.insert(account.subject.clone(), session.clone());
        session
    }

    /// Starts the session of a sign-in that just finished, with the access token it came
    /// with, replacing any earlier session of the account.
    pub(crate) fn signed_in(
        issuer: &str,
        account: &ChatGptAccount,
        access: Secret,
        lifetime: Duration,
    ) {
        let session = Self::new(issuer, account, Some((access, renew_at(lifetime))));
        sessions().insert(account.subject.clone(), session);
    }

    fn new(issuer: &str, account: &ChatGptAccount, access: Option<(Secret, Instant)>) -> Arc<Self> {
        Arc::new(Self {
            issuer: issuer.to_owned(),
            state: tokio::sync::Mutex::new(State {
                account: account.clone(),
                access,
            }),
        })
    }

    /// Whether this session belongs to the same sign-in as `account`: the same client, and
    /// a refresh token the session holds or held.
    fn started_from(&self, account: &ChatGptAccount) -> bool {
        // A session renewing right now holds the lock; it is the same sign-in by then.
        self.state.try_lock().map_or(true, |state| {
            state.account.client_id == account.client_id
                && (state.account.refresh_token == account.refresh_token || state.access.is_some())
        })
    }

    /// An access token good for a request, renewed first when it is missing or close to
    /// expiry.
    pub(crate) async fn token(&self) -> Result<Secret, PlanError> {
        let mut state = self.state.lock().await;
        if let Some((token, renew_at)) = &state.access
            && Instant::now() < *renew_at
        {
            return Ok(token.clone());
        }
        self.renew(&mut state).await
    }

    /// Forgets `token` after the API refused it, so the next [`Self::token`] renews. A token
    /// another request already replaced is left alone.
    pub(crate) async fn refused(&self, token: &Secret) {
        let mut state = self.state.lock().await;
        if state.access.as_ref().is_some_and(|(held, _)| held == token) {
            state.access = None;
        }
    }

    async fn renew(&self, state: &mut State) -> Result<Secret, PlanError> {
        let refresh = state
            .account
            .refresh_token
            .clone()
            .ok_or(PlanError::SignedOut)?;
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.expose()),
            ("client_id", state.account.client_id.as_str()),
        ];
        let tokens: Tokens = match tokens::request(&self.issuer, &form, error::from_refresh).await {
            Err(expired @ PlanError::SignInExpired) => {
                state.account.refresh_token = None;
                state.access = None;
                return Err(expired);
            }
            answer => answer?,
        };
        let access = Secret::parse(&tokens.access_token)
            .ok_or(PlanError::Answer("an empty access token".into()))?;
        if let Some(rotated) = tokens.refresh_token.as_deref().and_then(Secret::parse) {
            state.account.refresh_token = Some(rotated);
            save_refresh_token(&state.account).await;
        }
        state.access = Some((access.clone(), renew_at(tokens.lifetime())));
        Ok(access)
    }
}

/// When to renew an access token that lasts `lifetime`.
/// Never sooner than halfway through, so a short-lived token is not renewed on every request.
fn renew_at(lifetime: Duration) -> Instant {
    Instant::now() + lifetime.saturating_sub(RENEW_MARGIN).max(lifetime / 2)
}

/// Ends `account`'s sign-in at OpenAI, so Study leaves the user's connected apps, and drops
/// its live session. Retried a few times while the refresh token still works; a sign-out
/// that cannot reach OpenAI still signs out here.
pub async fn revoke(issuer: &str, account: &ChatGptAccount) -> Result<(), PlanError> {
    forget(&account.subject);
    let Some(refresh) = &account.refresh_token else {
        return Ok(());
    };
    let mut delay = Duration::from_secs(1);
    for _ in 1..REVOKE_ATTEMPTS {
        if revoke_once(issuer, account, refresh).await.is_ok() {
            return Ok(());
        }
        tokio::time::sleep(delay).await;
        delay *= 2;
    }
    revoke_once(issuer, account, refresh).await
}

/// One request to revoke `refresh`. A refresh token that no longer works has nothing left
/// to revoke, so its refusal counts as done.
async fn revoke_once(
    issuer: &str,
    account: &ChatGptAccount,
    refresh: &Secret,
) -> Result<(), PlanError> {
    let response = client(Timeouts::api(tokens::TIMEOUT))?
        .post(format!("{issuer}{REVOKE_PATH}"))
        .form(&[
            ("token", refresh.expose()),
            ("token_type_hint", "refresh_token"),
            ("client_id", account.client_id.as_str()),
        ])
        .send()
        .await?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    match error::from_refresh(status.as_u16(), &body) {
        PlanError::SignInExpired => Ok(()),
        failure => Err(failure),
    }
}

/// Saves `account`'s new refresh token, if the app gave a store and the same account is
/// still the signed-in one.
async fn save_refresh_token(account: &ChatGptAccount) {
    let Some(store) = saved_in().clone() else {
        return;
    };
    let subject = account.subject.clone();
    let refresh_token = account.refresh_token.clone();
    let saved = store
        .run(move |database| {
            let mut preferences = ChatGptPreferences::load(database)?;
            if let Some(saved) = preferences.account.as_mut()
                && saved.subject == subject
            {
                saved.refresh_token = refresh_token;
                preferences.save(database)?;
            }
            Ok(())
        })
        .await;
    if let Err(error) = saved {
        // The session keeps working from memory; only the next launch would need a sign-in.
        tracing::error!(%error, "cannot save the renewed ChatGPT sign-in");
    }
}

#[cfg(test)]
mod tests {
    use study_core::db::Store;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer};

    use super::*;
    use crate::testing::{TOKEN_PATH, account, tokens};

    #[tokio::test]
    async fn a_renewal_saves_the_rotated_refresh_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(TOKEN_PATH))
            .respond_with(tokens("access", "rotated"))
            .expect(1)
            .mount(&server)
            .await;
        let (_dir, store) = Store::temporary().unwrap();
        let account = account("first");
        let signed_in = ChatGptPreferences {
            account: Some(account.clone()),
            ..ChatGptPreferences::default()
        };
        store.with(|database| signed_in.save(database)).unwrap();
        remember_in(store.clone());

        Session::shared(&server.uri(), &account)
            .token()
            .await
            .unwrap();

        let saved = store.with(ChatGptPreferences::load).unwrap();
        assert_eq!(
            saved.account.and_then(|account| account.refresh_token),
            Secret::parse("rotated")
        );
    }
}
