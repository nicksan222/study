//! What can go wrong with a language model, and what kind each failure is.

use rig_agent::completion::PromptError;
use rig_core::completion::CompletionError;
use rig_core::http_client::Error as HttpError;
use study_core::{Classify, ErrorKind};

use crate::chat::provider::chatgpt::PlanError;
use crate::error::kind_of_status;

/// A result whose error is a language model [`Error`] unless it says otherwise.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// A language model request that failed: refused by the plan, failed on its way through
/// Rig, or answered with nothing usable.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Plan(#[from] PlanError),
    #[error(transparent)]
    Prompt(#[from] PromptError),
    #[error("the model's answer had nothing usable in it")]
    EmptyAnswer,
    /// The model said what it was given holds too little to do the work, in its own words
    /// (see [`AgentSpec::MAY_DECLINE`](crate::agent::AgentSpec::MAY_DECLINE)).
    #[error("{reason}")]
    Declined { reason: String },
}

impl Error {
    /// Whether the model answered, but with nothing usable: no answer to parse, or one cut
    /// short. Asking again may help, but unlike a service that failed or a missing sign-in,
    /// there is nothing to wait for, so a caller with a fallback may take it.
    pub fn is_unusable_answer(&self) -> bool {
        self.unusable_part().is_some()
    }

    /// A copy of this unusable answer, for another caller that asked the identical thing:
    /// errors can't be cloned, but these hold only text. `None` for any other failure.
    pub(crate) fn copy_unusable(&self) -> Option<Self> {
        self.unusable_part().map(|error| match error {
            Self::Plan(PlanError::Incomplete { reason }) => Self::Plan(PlanError::Incomplete {
                reason: reason.clone(),
            }),
            _ => Self::EmptyAnswer,
        })
    }

    /// The unusable answer itself, unwrapped from the model request that passed it up.
    fn unusable_part(&self) -> Option<&Self> {
        match self {
            Self::EmptyAnswer | Self::Plan(PlanError::Incomplete { .. }) => Some(self),
            Self::Prompt(PromptError::CompletionError(CompletionError::RequestError(inner))) => {
                inner.downcast_ref::<Error>().and_then(Error::unusable_part)
            }
            Self::Plan(_) | Self::Prompt(_) | Self::Declined { .. } => None,
        }
    }
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Plan(error) => error.kind(),
            Self::Prompt(PromptError::CompletionError(error)) => kind_of_completion(error),
            Self::Prompt(PromptError::PromptCancelled { .. }) => ErrorKind::Cancelled,
            Self::Prompt(_) => ErrorKind::Internal,
            // Models answer differently each time: asking again usually works.
            Self::EmptyAnswer => ErrorKind::Transient,
            // Asking again about the same material gets the same answer.
            Self::Declined { .. } => ErrorKind::NotEnough,
        }
    }
}

/// What a failed model request means: the plan's own refusal when the model passed one up,
/// else the status the provider answered with.
fn kind_of_completion(error: &CompletionError) -> ErrorKind {
    // The ChatGPT plan refused, inside the model.
    if let CompletionError::RequestError(inner) = error
        && let Some(refusal) = inner.downcast_ref::<Error>()
    {
        return refusal.kind();
    }
    if let Some(status) = error.provider_response_status() {
        return kind_of_status(status.as_u16());
    }
    match error {
        CompletionError::HttpError(
            HttpError::InvalidStatusCode(status)
            | HttpError::InvalidStatusCodeWithMessage(status, _)
            | HttpError::InvalidStatusCodeWithDetails { status, .. },
        ) => kind_of_status(status.as_u16()),
        // The connection itself failed.
        CompletionError::HttpError(HttpError::Instance(_)) => ErrorKind::Transient,
        _ => ErrorKind::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::provider::chatgpt::IncompleteReason;

    #[test]
    fn a_refusal_of_the_plan_keeps_its_kind_through_the_model_request() {
        let wrapped = Error::Prompt(PromptError::CompletionError(CompletionError::RequestError(
            Box::new(Error::Plan(PlanError::SignedOut)),
        )));
        // So signing in retries the work that failed for want of it.
        assert_eq!(wrapped.kind(), ErrorKind::Config);
        assert!(!wrapped.is_unusable_answer());
    }

    #[test]
    fn an_empty_or_cut_answer_is_unusable() {
        assert!(Error::EmptyAnswer.is_unusable_answer());
        let cut = Error::Prompt(PromptError::CompletionError(CompletionError::RequestError(
            Box::new(Error::Plan(PlanError::Incomplete {
                reason: IncompleteReason::MaxOutputTokens,
            })),
        )));
        assert!(cut.is_unusable_answer());
    }
}
