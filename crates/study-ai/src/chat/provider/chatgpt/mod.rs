//! The user's own ChatGPT plan, through
//! [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source): they
//! sign in once in the browser, and every request carries *their* OAuth token and counts
//! against *their* plan. Study holds no key of its own.
//!
//! The sign-in is OpenID Connect with PKCE and a loopback redirect. The first one registers
//! Study for the account (`client_id=dynamic_agent_client`) and OpenAI issues a client id,
//! which later refreshes, sign-ins and revocation reuse. Inference is the public Responses
//! API with the account's access token, streamed, never stored.
//!
//! | File         | What it holds                                                      |
//! |--------------|--------------------------------------------------------------------|
//! | `account.rs` | [`ChatGptAccount`] and [`ChatGptPreferences`], what is saved       |
//! | `login.rs`   | [`SignIn`]: the browser sign-in, from authorize URL to account     |
//! | `session.rs` | `Session`: the live access token, refreshed and rotated safely     |
//! | `tokens.rs`  | The token endpoint, shared by the sign-in and every renewal        |
//! | `model.rs`   | `PlanModel`, the Rig model that sends Responses requests           |
//! | `error.rs`   | [`PlanError`], what the plan API and the sign-in can refuse        |

mod account;
mod error;
mod login;
mod model;
mod session;
mod tokens;

use std::time::Duration;

use rig_agent::ModelHandle;

use crate::ApiConfig;
use crate::chat::error::Result;
use crate::chat::{LlmModel, Tier};

pub use account::{ChatGptAccount, ChatGptPreferences, HostId};
pub use error::{IncompleteReason, PlanError};
pub use login::SignIn;
pub(crate) use session::remember_in;
pub use session::revoke;

/// The provider's name, on its models and in Rig's traces.
pub const NAME: &str = "chatgpt";

/// Where the sign-in and token endpoints live, and the issuer ID tokens must name.
pub const ISSUER: &str = "https://auth.openai.com";
/// The issuer's endpoints, as its `/.well-known/openid-configuration` names them.
const AUTHORIZE_PATH: &str = "/api/accounts/authorize";
pub(crate) const TOKEN_PATH: &str = "/api/accounts/oauth/token";
pub(crate) const REVOKE_PATH: &str = "/api/accounts/oauth/revoke";
/// Where plan requests go, and the `resource` the access token is issued for.
pub const API_BASE: &str = "https://api.openai.com/v1";
/// Where the Responses API answers prompts, under [`API_BASE`].
pub(crate) const RESPONSES_PATH: &str = "/responses";
/// The scope that lets Study use the plan, written once for both constants below.
macro_rules! plan_scope {
    () => {
        "chatgpt.tokens.use.direct"
    };
}
/// What Study asks for: who the account is, a refresh token, and use of the plan.
pub const SCOPE: &str = concat!(
    "openid profile email offline_access resource.invoke ",
    plan_scope!()
);
/// The granted scope that lets Study use the plan; signing in alone does not.
pub const PLAN_SCOPE: &str = plan_scope!();
/// Where the user sees and limits what each app uses of their plan.
pub const USAGE_SETTINGS_URL: &str = "https://chatgpt.com/#settings/Usage";

/// The model the plan serves `tier` with by default: OpenAI's GPT-6 family, smallest to
/// largest, as the plan offers them (<https://learn.chatgpt.com/docs/models>).
pub fn default_model(tier: Tier) -> LlmModel {
    match tier {
        Tier::Tiny => LlmModel::Gpt6Luna,
        Tier::Medium => LlmModel::Gpt61Sol,
        Tier::Smart => LlmModel::Gpt6Astra,
    }
}

/// How the plan is reached for `tier`, with its default model.
pub fn defaults(tier: Tier) -> ApiConfig {
    ApiConfig {
        base_url: API_BASE.into(),
        model: default_model(tier).code().into(),
        timeout: Duration::from_secs(300),
    }
}

/// One tier's model on the user's plan.
#[derive(Clone, Debug)]
pub struct ChatGptConfig {
    /// The address, model, and timeout; requests carry the account's own token.
    pub api: ApiConfig,
    /// The sign-in server; [`ISSUER`] except in tests.
    pub issuer: String,
    /// `None` when nobody is signed in: requests then fail as a setup problem.
    pub account: Option<ChatGptAccount>,
}

/// The Rig model for `config`. Nothing is sent until an agent is prompted.
pub(super) fn model(config: &ChatGptConfig) -> Result<ModelHandle> {
    let session = config
        .account
        .as_ref()
        .map(|account| session::Session::shared(&config.issuer, account));
    Ok(ModelHandle::named(
        NAME,
        model::PlanModel::new(config.api.clone(), session),
    ))
}
