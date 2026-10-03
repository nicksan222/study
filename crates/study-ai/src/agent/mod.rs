//! Agents on the language models: the kit every agent in Study is built with, wherever it
//! runs (a pipeline enhancer, a conversation reply, a session title).
//!
//! An agent is a unit struct implementing [`AgentSpec`]: its name, the smallest
//! [`Tier`](crate::chat::Tier) that does the job, its instructions, how its input becomes a
//! prompt (user and file text passed through [`escape`], passages it may cite as
//! [`numbered_sources`]) and how the answer is parsed (often with [`plain_answer`] or
//! [`json_answer`]). An agent that writes study material from the student's own sources
//! [may decline](AgentSpec::MAY_DECLINE) when they hold too little, rather than fill in
//! from general knowledge. [`AgentRuntime`] hands out a [`Runner`] for it
//! on the model the user chose for that tier.
//!
//! | File         | What it holds                                                       |
//! |--------------|---------------------------------------------------------------------|
//! | `spec.rs`    | [`AgentSpec`], what makes an agent itself, and its [`Runner`]       |
//! | `runtime.rs` | [`AgentRuntime`]: the database, and models from the preferences     |
//! | `sources.rs` | [`numbered_sources`] and [`cited_sources`], with `place`: passages as a prompt shows them |
//! | `text.rs`    | [`escape`] for prompts, and [`plain_answer`], [`json_answer`], [`declined`] and [`strip_reasoning`] for answers |

mod runtime;
mod sources;
mod spec;
mod text;

pub use runtime::{AgentRuntime, unconfigured};
pub use sources::{cited_sources, numbered_sources};
pub use spec::{AgentSpec, Runner};
pub(crate) use text::{DECLINE_INSTRUCTION, language_instruction};
pub use text::{declined, escape, escape_attribute, json_answer, plain_answer, strip_reasoning};
