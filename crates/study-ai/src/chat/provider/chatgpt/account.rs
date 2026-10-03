//! What Study keeps about the signed-in ChatGPT account, stored under the `chatgpt` scope.
//!
//! This is its own scope, not part of the language model settings, because refreshing the
//! access token rotates the refresh token: a settings form holding an older copy must never
//! be able to write it back.

use serde::{Deserialize, Serialize};
use study_core::preferences::Secret;

/// A ChatGPT account Study signed in to. The `Debug` of the refresh token is redacted.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ChatGptAccount {
    /// The client id OpenAI issued Study for this account on this computer.
    pub client_id: String,
    /// The account's stable id (the ID token's `sub`).
    pub subject: String,
    /// Shown in Settings as "signed in as".
    pub email: Option<String>,
    /// Whether the user let Study use their plan. Signing in alone does not.
    pub sharing: bool,
    /// Renews the access token; OpenAI replaces it on every refresh.
    pub refresh_token: Option<Secret>,
}

impl ChatGptAccount {
    /// Whether requests can run on this account's plan.
    pub fn is_usable(&self) -> bool {
        self.sharing && self.refresh_token.is_some()
    }
}

/// This computer's `ext_agent_host_id`: generated once, opaque, and kept across sign-ins and
/// sign-outs so OpenAI sees one host.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HostId(String);

impl HostId {
    /// A new random id, as a `urn:uuid:`.
    pub fn generate() -> Self {
        Self(format!("urn:uuid:{}", uuid::Uuid::new_v4()))
    }

    /// The id as OpenAI is sent it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

study_core::preferences! {
    /// The ChatGPT account whose plan the language models may use, and what signing in
    /// again reuses. Written only by signing in, refreshing, and signing out.
    #[preferences(scope = "chatgpt")]
    pub struct ChatGptPreferences {
        pub account: Option<ChatGptAccount> = None,
        pub host_id: Option<HostId> = None,
        /// The client id of the last account, kept after signing out so signing in to it
        /// again reuses the registration.
        pub client_id: Option<String> = None,
    }
}

impl ChatGptPreferences {
    /// This computer's host id, generating it on first use; the caller saves.
    pub fn host_id(&mut self) -> HostId {
        self.host_id.get_or_insert_with(HostId::generate).clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::db::Database;

    fn account() -> ChatGptAccount {
        ChatGptAccount {
            client_id: "issued".into(),
            subject: "user-1".into(),
            email: Some("ada@example.com".into()),
            sharing: true,
            refresh_token: Secret::parse("refresh-secret"),
        }
    }

    #[test]
    fn an_account_needs_both_sharing_and_a_refresh_token() {
        assert!(account().is_usable());
        let not_sharing = ChatGptAccount {
            sharing: false,
            ..account()
        };
        assert!(!not_sharing.is_usable());
        let no_token = ChatGptAccount {
            refresh_token: None,
            ..account()
        };
        assert!(!no_token.is_usable());
        assert!(!format!("{:?}", account()).contains("refresh-secret"));
    }

    #[test]
    fn the_host_id_is_generated_once_and_opaque() {
        let mut preferences = ChatGptPreferences::default();
        let first = preferences.host_id();
        assert_eq!(preferences.host_id(), first);
        assert!(first.as_str().starts_with("urn:uuid:"));
    }

    #[test]
    fn the_account_and_registration_read_back_as_saved() -> study_core::Result<()> {
        let (_dir, db) = Database::temporary()?;
        let mut preferences = ChatGptPreferences {
            account: Some(account()),
            client_id: Some("issued".into()),
            ..ChatGptPreferences::default()
        };
        preferences.host_id();
        preferences.save(&db)?;
        assert_eq!(ChatGptPreferences::load(&db)?, preferences);
        Ok(())
    }
}
