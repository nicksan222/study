//! What the Quiz page draws, one file per view.
//!
//! | File | Draws |
//! |---|---|
//! | `quiz.rs` | an open quiz: its header and score, the question on screen, the results |
//! | `question.rs` | the question on screen: its choices or answer box, then its verdict |
//! | `results.rs` | the questions answered so far, each opening to show how it went |
//! | `parts.rs` | what the views share: verdicts, answers, sources and job problems |

mod parts;
mod question;
mod quiz;
mod results;
