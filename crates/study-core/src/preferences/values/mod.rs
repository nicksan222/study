//! Checked building blocks for preferences. Each parses from what a user types and refuses
//! anything invalid, so a value that exists is a value that works.
//!
//! To add one:
//! 1. A file here with the type, its `Serialize`/`Deserialize` (refusing invalid stored
//!    values too, as [`Count`] does with `try_from`), its
//!    [`Preference`](crate::preferences::Preference) impl when a settings form edits it
//!    ([`Secret`] is set by sign-in instead), and unit tests.
//! 2. An [`Invalid`](crate::preferences::Invalid) variant for what it refuses. The desktop
//!    settings pages match on `Invalid`, so they stop compiling until they give it a message
//!    from `study-localization`.
//! 3. Its re-export here and in [`crate::preferences`](mod@crate::preferences).
//!
//! A value with nothing to check needs none of this: add it to `plain!` in `preference.rs`.

mod count;
mod per_choice;
mod secret;

pub use count::Count;
pub use per_choice::PerChoice;
pub use secret::Secret;
