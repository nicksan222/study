//! What the pages of material draw, one file per view.
//!
//! | File | Draws |
//! |---|---|
//! | `empty.rs` | a project with nothing of the page's kind yet: Make |
//! | `material.rs` | one piece of material, opened: its text, flashcards or diagram, and sources |
//! | `reviews.rs` | the cards due and how reviews go, in every project and in each |
//! | `review.rs` | a review under way, one card at a time |
//! | `status.rs` | a piece's status line: up to date, or outdated with Update, or how its update is going |
//! | `writing.rs` | a piece still being written: a spinner, how far it is, and a breathing outline |
//! | `card_face.rs` | the large face of one card, as the deck and a review show it, and a progress bar |

mod card_face;
mod empty;
mod material;
mod review;
mod reviews;
mod status;
mod writing;
