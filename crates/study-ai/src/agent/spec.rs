//! [`AgentSpec`], what makes each agent itself, and [`Runner`], which runs any of them.

use std::marker::PhantomData;

use rig_agent::completion::Prompt as _;
use rig_agent::{Agent, AgentBuilder};

use study_core::Language;

use super::{DECLINE_INSTRUCTION, declined, language_instruction};
use crate::chat::{Error, Models, Result, Tier};

/// What makes an agent this agent: its tier, instructions, how its input becomes a prompt,
/// and how its answer becomes a result. [`Runner`] does the rest the same way for all.
pub trait AgentSpec: Send + Sync + 'static {
    /// Stable identifier, for logs and Rig's traces, such as `session-title`.
    const NAME: &'static str;
    /// The smallest tier that does the job well.
    const TIER: Tier;
    /// The system prompt. [`Runner`] adds the student's [`Language`] to it unless
    /// [`Self::WRITES_FOR_STUDENT`] is off.
    const INSTRUCTIONS: &'static str;
    /// Whether what it writes is for the student, and so in their language. Off for an agent
    /// that must keep the language of its input, such as one correcting a transcript.
    const WRITES_FOR_STUDENT: bool = true;
    /// Whether it may decline when its input holds too little to work from, as a writer of
    /// study material does rather than pad it with what the sources never said. [`Runner`]
    /// then tells the model how, and turns such an answer into [`Error::Declined`].
    const MAY_DECLINE: bool = false;

    /// What the agent works from, such as a conversation or a set of excerpts.
    type Input: Send + Sync;
    /// What it makes of the answer.
    type Output: Send;

    /// The user prompt for `input`.
    fn prompt(input: &Self::Input) -> String;

    /// The result in the model's answer, or `None` when it has nothing usable.
    fn parse(answer: &str) -> Option<Self::Output>;

    /// Finishes the Rig agent. Override to add tools, context, or an output schema.
    fn build(agent: AgentBuilder) -> Agent {
        agent.build()
    }
}

/// The system prompt of `S`: how to decline when it may, and the student's `language`
/// when it writes for them.
fn instructions<S: AgentSpec>(language: Language) -> String {
    let mut instructions = S::INSTRUCTIONS.to_owned();
    if S::MAY_DECLINE {
        instructions = format!("{instructions} {DECLINE_INSTRUCTION}");
    }
    if S::WRITES_FOR_STUDENT {
        instructions = format!("{instructions}\n\n{}", language_instruction(language));
    }
    instructions
}

/// An [`AgentSpec`] on the model its tier maps to.
pub struct Runner<S> {
    agent: Agent,
    spec: PhantomData<fn() -> S>,
}

impl<S: AgentSpec> Runner<S> {
    /// `S` on the model `models` has for its tier, writing for a student who reads
    /// `language`.
    pub fn new(models: &Models, language: Language) -> Self {
        let instructions = instructions::<S>(language);
        // No sampling options: several current models accept only their defaults.
        let builder = models.agent(S::TIER).name(S::NAME).preamble(&instructions);
        Self {
            agent: S::build(builder),
            spec: PhantomData,
        }
    }

    /// Prompts the model with `input` and parses its answer; an answer with nothing usable
    /// is [`Error::EmptyAnswer`], and one that declines (when `S` may) [`Error::Declined`].
    pub async fn run(&self, input: &S::Input) -> Result<S::Output> {
        let answer = self.agent.prompt(S::prompt(input)).await?;
        if S::MAY_DECLINE
            && let Some(reason) = declined(&answer)
        {
            return Err(Error::Declined { reason });
        }
        S::parse(&answer).ok_or(Error::EmptyAnswer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tutor;
    impl AgentSpec for Tutor {
        const NAME: &'static str = "tutor";
        const TIER: Tier = Tier::Tiny;
        const INSTRUCTIONS: &'static str = "Explain.";
        type Input = ();
        type Output = ();
        fn prompt(_: &()) -> String {
            String::new()
        }
        fn parse(_: &str) -> Option<()> {
            Some(())
        }
    }

    struct Scribe;
    impl AgentSpec for Scribe {
        const NAME: &'static str = "scribe";
        const TIER: Tier = Tier::Tiny;
        const INSTRUCTIONS: &'static str = "Copy.";
        const WRITES_FOR_STUDENT: bool = false;
        type Input = ();
        type Output = ();
        fn prompt(_: &()) -> String {
            String::new()
        }
        fn parse(_: &str) -> Option<()> {
            Some(())
        }
    }

    #[test]
    fn agents_write_in_the_students_language_unless_they_keep_their_inputs() {
        let tutor = instructions::<Tutor>(Language::Italian);
        assert!(
            tutor.starts_with("Explain.") && tutor.contains("in Italian"),
            "{tutor}"
        );
        assert_eq!(instructions::<Scribe>(Language::Italian), "Copy.");
    }

    struct Writer;
    impl AgentSpec for Writer {
        const NAME: &'static str = "writer";
        const TIER: Tier = Tier::Tiny;
        const INSTRUCTIONS: &'static str = "Write.";
        const MAY_DECLINE: bool = true;
        type Input = ();
        type Output = ();
        fn prompt(_: &()) -> String {
            String::new()
        }
        fn parse(_: &str) -> Option<()> {
            Some(())
        }
    }

    #[test]
    fn only_an_agent_that_may_decline_is_told_how() {
        let writer = instructions::<Writer>(Language::English);
        assert!(
            writer.starts_with("Write. If what you are given"),
            "{writer}"
        );
        assert!(
            writer.contains("CANNOT:")
                && writer.ends_with(
                    "in English, whatever the language of the sources, the notes or the question."
                )
        );
        assert!(!instructions::<Tutor>(Language::English).contains("CANNOT:"));
    }
}
