//! The conversation and practice agents, and the job handlers that run them. The kit they
//! are built with ([`AgentSpec`], [`Runner`](study_ai::agent::Runner), [`AgentRuntime`]) is
//! `study_ai::agent`, and every agent imports it from there.
//!
//! Each agent is a Rig agent on the smallest [`Tier`](study_ai::chat::Tier) that does its
//! job, run by a job handler: the handler reads what it needs from the database, runs the
//! agent, and writes the result back. The jobs engine announces the change.
//!
//! | File              | What it holds                                                    |
//! |-------------------|------------------------------------------------------------------|
//! | `conversation.rs` | [`Conversation`]: a session as a prompt, within a [`Budget`]     |
//! | `title/`          | Names sessions from their notes (tiny tier), in the background   |
//! | `reply/`          | Answers notes that mention the assistant, citing the material    |
//! | `rewrite/`        | Writes a new version of a message's text: improved, summarized, or as asked |
//! | `question/`       | Writes a practice's next question from its sessions, citing them |
//! | `grade/`          | Grades an answer to an open practice question, and says why      |
//!
//! Every agent folder has the same shape:
//!
//! - `mod.rs`: the unit struct implementing [`AgentSpec`] (its name, tier, instructions, how
//!   its input becomes a prompt, usually with [`Conversation::render`], and how its answer
//!   is parsed, often with `plain_answer`), and unit tests of the prompt and the parsing;
//! - `handler.rs`: the [`JobHandler`](study_core::jobs::JobHandler) for its
//!   [`JobKind`](study_core::JobKind), on [`Lane::Llm`](study_core::jobs::Lane::Llm). It
//!   reads its input with [`AgentRuntime::blocking`], runs the agent from
//!   [`AgentRuntime::required`], and stores the result. Errors become classified failures
//!   through `study_core::jobs`; one for want of a model is retried once the user signs in.
//!
//! To add an agent, copy `title/` (the smallest). It needs its job kind, its registration in
//! `handlers` (in `app/workers.rs`), the command that queues it, and a test in `tests/` against
//! the wiremock `Fixture`.
//!
//! [`AgentSpec`]: study_ai::agent::AgentSpec
//! [`AgentRuntime`]: study_ai::agent::AgentRuntime
//! [`AgentRuntime::blocking`]: study_ai::agent::AgentRuntime::blocking
//! [`AgentRuntime::required`]: study_ai::agent::AgentRuntime::required

mod conversation;
pub(crate) mod grade;
pub(crate) mod question;
pub(crate) mod reply;
pub(crate) mod rewrite;
pub(crate) mod title;

pub(crate) use conversation::{Budget, Conversation};
