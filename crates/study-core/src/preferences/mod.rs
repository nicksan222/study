//! Typed, persistent preferences that each crate declares for itself.
//!
//! A feature keeps its settings next to its code, in its own `preferences.rs`:
//!
//! ```
//! use study_core::preferences::{Count, PerChoice};
//!
//! study_core::choice! {
//!     /// Which backend reads documents.
//!     pub enum Reader {
//!         #[default]
//!         Local = "local",
//!         Cloud = "cloud",
//!     }
//! }
//!
//! study_core::preferences! {
//!     /// How documents are read.
//!     #[preferences(scope = "reader", form = ReaderForm)]
//!     pub struct ReaderPreferences {
//!         pub reader: Reader = Reader::Local,
//!         /// Copies of the local model kept in memory.
//!         pub local_instances: Count<2> = Count::ONE,
//!         /// Pages read at once by each backend, kept when switching between them.
//!         pub parallel: PerChoice<Reader, Option<Count<8>>> = PerChoice::default(),
//!     }
//! }
//! ```
//!
//! | File          | What it holds                                               |
//! |---------------|-------------------------------------------------------------|
//! | `define.rs`   | [`crate::preferences!`], which declares a group             |
//! | `choice.rs`   | [`crate::choice!`] and [`Choice`], for pick-one enums       |
//! | `preference.rs` | [`Preference`], what a field must be, and [`Invalid`]     |
//! | `values/`     | Checked field types: counts, secrets, a value per choice |
//! | `store.rs`    | The rows in the [`Database`](crate::db::Database)           |

mod choice;
mod define;
mod preference;
mod store;
mod values;

pub use choice::Choice;
pub use preference::{Invalid, Preference};
pub use store::{Stored, encode};
pub use values::{Count, PerChoice, Secret};

/// A group of settings declared with [`preferences!`](crate::preferences!), stored under its
/// own scope. Lets code that owns the database load and save any group generically.
pub trait PreferenceSet: Clone + Default + Send + Sync + Sized + 'static {
    /// Where these preferences are stored; unique across the app.
    const SCOPE: &'static str;

    /// The stored values, with defaults for anything never saved.
    fn load(database: &crate::db::Database) -> crate::Result<Self>;

    /// Replaces every stored value of the group with these.
    fn save(&self, database: &crate::db::Database) -> crate::Result<()>;
}
