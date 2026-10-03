//! Practice: an endless quiz over a project, one question at a time. A
//! question is written by a model from the project's files and notes, as a
//! [`WrittenQuestion`]: its long form, the [`PracticeBody`] the student sees, and its short
//! form, a one-line gist that later writers are shown so they do not ask it again. The
//! student answers it with a [`PracticeAnswer`], and gets a [`Verdict`]: at once for a
//! choice, from a model for an answer in their own words.
//!
//! A practice never ends: whenever fewer than two questions wait to be answered, another
//! is queued (see `db/practice/`). It is the one kind of quiz Study has, one per project,
//! started from the Practice page or the project.
//!
//! To add a kind of question, add it to [`QuestionKind`] (and decide
//! [`QuestionKind::for_ordinal`]), a [`PracticeBody`] and a [`PracticeAnswer`] variant, and
//! the arms their exhaustive matches ask for.

use std::collections::HashSet;
use std::ops::RangeInclusive;

use serde::{Deserialize, Serialize};

use crate::{ErrorKind, Result, bail};

crate::text_enum! {
    /// How a question is answered.
    pub enum QuestionKind {
        /// By picking one of a few choices; graded at once.
        Choice = "choice",
        /// In the student's own words; a model grades it.
        Open = "open",
    }
}

impl QuestionKind {
    /// The kind of the question at `ordinal` (counted from 0) in a practice: one in three is
    /// open, the rest are choices, so every practice mixes them the same way.
    pub const fn for_ordinal(ordinal: u32) -> Self {
        if ordinal % 3 == 2 {
            Self::Open
        } else {
            Self::Choice
        }
    }
}

crate::text_enum! {
    /// How far a question has got. How its latest job ended is on the job.
    pub enum QuestionStatus {
        /// Waiting for its job to write it.
        Pending = "pending",
        /// Being written.
        Writing = "writing",
        /// Written, waiting for the student's answer.
        Ready = "ready",
        /// An open answer waiting for its grade.
        Answered = "answered",
        /// Answered and graded: it has a verdict.
        Graded = "graded",
    }
}

impl QuestionStatus {
    /// Whether the question still waits for the student: not yet answered. A practice keeps
    /// two of these ahead. Exhaustive, so a new status must decide here.
    pub const fn is_unanswered(self) -> bool {
        match self {
            Self::Pending | Self::Writing | Self::Ready => true,
            Self::Answered | Self::Graded => false,
        }
    }
}

crate::text_enum! {
    /// How right an answer is.
    pub enum Verdict {
        Correct = "correct",
        /// Right in part: something is wrong or missing. Only open answers get it.
        Partly = "partly",
        Incorrect = "incorrect",
    }
}

/// How many choices a choice question offers.
pub const CHOICES: RangeInclusive<usize> = 2..=6;

/// Longest gist of a question, in characters; the writer is asked for 5 to 15 words.
pub const MAX_GIST_CHARS: usize = 200;

/// A question as its writer wrote it, in both forms.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WrittenQuestion {
    /// The short form: what the question tests, in one line ("Order of mitosis phases").
    /// Only this goes back to later writers as already asked, so the list stays cheap.
    pub gist: String,
    /// The long form: what the student sees, and what grading reads.
    pub body: PracticeBody,
}

impl WrittenQuestion {
    /// Fails with [`ErrorKind::InvalidInput`] unless the question can be asked: its gist is
    /// one non-empty line of at most [`MAX_GIST_CHARS`], and its body passes
    /// [`PracticeBody::check`].
    pub fn check(&self) -> Result<()> {
        let gist = self.gist.trim();
        if gist.is_empty() || gist.contains('\n') {
            bail!(ErrorKind::InvalidInput, "a question needs a one-line gist");
        }
        if gist.chars().count() > MAX_GIST_CHARS {
            bail!(
                ErrorKind::InvalidInput,
                "a gist longer than {MAX_GIST_CHARS} characters"
            );
        }
        self.body.check()
    }
}

/// A written question. Each cites the passages it rests on by marker, as an answer does.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PracticeBody {
    Choice {
        question: String,
        choices: Vec<String>,
        /// Index of the right choice.
        answer: u32,
        /// Why that choice is right.
        #[serde(default)]
        explanation: String,
        #[serde(default)]
        cites: Vec<u32>,
    },
    Open {
        question: String,
        /// What a good answer says, for grading.
        reference: String,
        #[serde(default)]
        cites: Vec<u32>,
    },
}

impl PracticeBody {
    /// The question as a flashcard: what it asks on the front, and on the back the right
    /// answer (with why, for a choice) or what a good answer says.
    pub fn as_card(&self) -> (String, String) {
        match self {
            Self::Choice {
                question,
                choices,
                answer,
                explanation,
                ..
            } => {
                let right = choices.get(*answer as usize).map_or("", String::as_str);
                let back = if explanation.trim().is_empty() {
                    right.trim().to_owned()
                } else {
                    format!("{}\n\n{}", right.trim(), explanation.trim())
                };
                (question.trim().to_owned(), back)
            }
            Self::Open {
                question,
                reference,
                ..
            } => (question.trim().to_owned(), reference.trim().to_owned()),
        }
    }

    /// The kind of question this body is.
    pub const fn kind(&self) -> QuestionKind {
        match self {
            Self::Choice { .. } => QuestionKind::Choice,
            Self::Open { .. } => QuestionKind::Open,
        }
    }

    /// The question asked.
    pub fn question(&self) -> &str {
        match self {
            Self::Choice { question, .. } | Self::Open { question, .. } => question,
        }
    }

    /// Markers of the passages it rests on.
    pub fn cites(&self) -> &[u32] {
        match self {
            Self::Choice { cites, .. } | Self::Open { cites, .. } => cites,
        }
    }

    /// Turns a choice question's choices `by` places, the right one with them, so it is
    /// not always where the writer put it: models favour the first place. An open question
    /// is left as it is.
    pub fn turn_choices(&mut self, by: usize) {
        if let Self::Choice {
            choices, answer, ..
        } = self
            && !choices.is_empty()
        {
            let by = by % choices.len();
            choices.rotate_right(by);
            *answer = ((*answer as usize + by) % choices.len()) as u32;
        }
    }

    /// Fails with [`ErrorKind::InvalidInput`] unless the question can be asked: it has a
    /// question, a choice question has [`CHOICES`] distinct choices and its answer is one of
    /// them, and an open one has a reference answer.
    pub fn check(&self) -> Result<()> {
        if self.question().trim().is_empty() {
            bail!(ErrorKind::InvalidInput, "a question without a question");
        }
        match self {
            Self::Choice {
                choices, answer, ..
            } => {
                if !CHOICES.contains(&choices.len()) {
                    bail!(
                        ErrorKind::InvalidInput,
                        "a choice question with {} choices",
                        choices.len()
                    );
                }
                if choices.iter().any(|choice| choice.trim().is_empty()) {
                    bail!(ErrorKind::InvalidInput, "an empty choice");
                }
                let distinct: HashSet<&str> = choices.iter().map(|choice| choice.trim()).collect();
                if distinct.len() != choices.len() {
                    bail!(ErrorKind::InvalidInput, "the same choice twice");
                }
                if *answer as usize >= choices.len() {
                    bail!(ErrorKind::InvalidInput, "the right choice is not a choice");
                }
            }
            Self::Open { reference, .. } => {
                if reference.trim().is_empty() {
                    bail!(
                        ErrorKind::InvalidInput,
                        "an open question without a reference"
                    );
                }
            }
        }
        Ok(())
    }
}

/// The student's answer to a question.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum PracticeAnswer {
    /// The index of the picked choice.
    Choice(u32),
    /// The answer in their own words.
    Open(String),
}

impl PracticeAnswer {
    /// The kind of question this answers.
    pub const fn kind(&self) -> QuestionKind {
        match self {
            Self::Choice(_) => QuestionKind::Choice,
            Self::Open(_) => QuestionKind::Open,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(choices: &[&str], answer: u32) -> PracticeBody {
        PracticeBody::Choice {
            question: "What powers the cell?".into(),
            choices: choices.iter().map(|choice| (*choice).to_owned()).collect(),
            answer,
            explanation: String::new(),
            cites: vec![1],
        }
    }

    #[test]
    fn turning_choices_keeps_the_right_one_right() {
        let mut body = choice(&["ATP", "DNA", "RNA"], 0);
        body.turn_choices(4);
        let PracticeBody::Choice {
            choices, answer, ..
        } = &body
        else {
            unreachable!()
        };
        assert_eq!(choices, &["RNA", "ATP", "DNA"]);
        assert_eq!(choices[*answer as usize], "ATP");
        assert!(body.check().is_ok());

        for by in [0, 3, usize::MAX] {
            let mut turned = choice(&["ATP", "DNA", "RNA"], 1);
            turned.turn_choices(by);
            let (front, back) = turned.as_card();
            assert_eq!(
                (front.as_str(), back.as_str()),
                ("What powers the cell?", "DNA")
            );
        }
        let open = PracticeBody::Open {
            question: "q".into(),
            reference: "r".into(),
            cites: Vec::new(),
        };
        let mut turned = open.clone();
        turned.turn_choices(2);
        assert_eq!(turned, open);
    }

    #[test]
    fn one_question_in_three_is_open() {
        let kinds: Vec<QuestionKind> = (0..6).map(QuestionKind::for_ordinal).collect();
        use QuestionKind::{Choice, Open};
        assert_eq!(kinds, [Choice, Choice, Open, Choice, Choice, Open]);
    }

    #[test]
    fn bodies_and_answers_know_their_kind() {
        for kind in QuestionKind::ALL {
            let body = match kind {
                QuestionKind::Choice => choice(&["a", "b"], 0),
                QuestionKind::Open => PracticeBody::Open {
                    question: "q".into(),
                    reference: "r".into(),
                    cites: Vec::new(),
                },
            };
            let answer = match kind {
                QuestionKind::Choice => PracticeAnswer::Choice(0),
                QuestionKind::Open => PracticeAnswer::Open("a".into()),
            };
            assert_eq!((body.kind(), answer.kind()), (*kind, *kind));
        }
    }

    #[test]
    fn only_askable_questions_pass_the_check() {
        assert!(
            choice(&["Mitochondria", "Ribosomes", "Nucleus"], 0)
                .check()
                .is_ok()
        );
        for broken in [
            choice(&["Mitochondria"], 0),
            choice(&["Mitochondria", " "], 0),
            choice(&["Mitochondria", "Mitochondria "], 0),
            choice(&["Mitochondria", "Ribosomes"], 2),
            PracticeBody::Open {
                question: "Why?".into(),
                reference: "".into(),
                cites: Vec::new(),
            },
            PracticeBody::Open {
                question: " ".into(),
                reference: "Because".into(),
                cites: Vec::new(),
            },
        ] {
            let error = broken.check().unwrap_err();
            assert_eq!(error.kind(), ErrorKind::InvalidInput, "{broken:?}");
        }
    }

    #[test]
    fn a_written_question_needs_a_one_line_gist() {
        let written = |gist: &str| WrittenQuestion {
            gist: gist.into(),
            body: choice(&["Mitochondria", "Ribosomes"], 0),
        };
        assert!(written("Where cells make ATP").check().is_ok());
        let long = "word ".repeat(MAX_GIST_CHARS);
        for gist in [" ", "Where cells\nmake ATP", long.as_str()] {
            let error = written(gist).check().unwrap_err();
            assert_eq!(error.kind(), ErrorKind::InvalidInput, "{gist:?}");
        }
        let broken = WrittenQuestion {
            body: choice(&["Mitochondria"], 0),
            ..written("Where cells make ATP")
        };
        assert!(broken.check().is_err());
    }

    #[test]
    fn statuses_split_into_unanswered_and_answered() {
        let unanswered: Vec<_> = QuestionStatus::ALL
            .iter()
            .filter(|status| status.is_unanswered())
            .collect();
        assert_eq!(
            unanswered,
            [
                &QuestionStatus::Pending,
                &QuestionStatus::Writing,
                &QuestionStatus::Ready
            ]
        );
    }
}
