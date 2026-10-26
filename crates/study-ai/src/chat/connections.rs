//! [`Connections`]: the credentials every model provider signed in with, loaded together.

use study_core::Result;
use study_core::db::Database;

use crate::chat::LlmProvider;
use crate::chat::provider::chatgpt::{ChatGptAccount, ChatGptPreferences};

/// What the user connected Study to, one field per provider that signs in. Each provider
/// keeps its credentials in its own preferences scope; this gathers them for whatever
/// decides whether a tier can run and builds its models, so a new provider with
/// credentials of its own adds a field here, not a parameter everywhere.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Connections {
    /// The signed-in ChatGPT account, whether or not it shares its plan.
    pub chatgpt: Option<ChatGptAccount>,
}

impl Connections {
    /// The credentials saved in `database`.
    pub fn load(database: &Database) -> Result<Self> {
        Ok(Self {
            chatgpt: ChatGptPreferences::load(database)?.account,
        })
    }

    /// Whether `provider` has what it needs to run: the ChatGPT plan needs an account
    /// that shares it.
    pub fn is_connected(&self, provider: LlmProvider) -> bool {
        match provider {
            LlmProvider::ChatGpt => self.chatgpt.as_ref().is_some_and(ChatGptAccount::is_usable),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::preferences::Secret;

    #[test]
    fn loads_the_saved_account_and_connects_only_a_shared_plan() -> Result<()> {
        let (_dir, database) = Database::temporary()?;
        let connections = Connections::load(&database)?;
        assert_eq!(connections, Connections::default());
        assert!(!connections.is_connected(LlmProvider::ChatGpt));

        let account = ChatGptAccount {
            client_id: "issued".into(),
            subject: "user-1".into(),
            email: None,
            sharing: false,
            refresh_token: Secret::parse("refresh-secret"),
        };
        ChatGptPreferences {
            account: Some(account.clone()),
            ..ChatGptPreferences::default()
        }
        .save(&database)?;
        let connections = Connections::load(&database)?;
        assert_eq!(connections.chatgpt, Some(account.clone()));
        assert!(
            !connections.is_connected(LlmProvider::ChatGpt),
            "not shared"
        );

        let shared = Connections {
            chatgpt: Some(ChatGptAccount {
                sharing: true,
                ..account
            }),
        };
        assert!(shared.is_connected(LlmProvider::ChatGpt));
        Ok(())
    }
}
