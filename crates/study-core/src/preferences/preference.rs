//! What any value needs to be a field of a [`crate::preferences!`] struct.

use std::fmt::Debug;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// A value that can be stored as a preference and edited in a settings form.
///
/// Every value has two shapes: itself, always valid, and its [`Self::Form`], exactly as
/// typed. [`Self::from_form`] is the only way from one to the other, so nothing unchecked
/// reaches storage or the code that uses it. Storage uses the serde shape as JSON.
pub trait Preference: Clone + Debug + Eq + Serialize + DeserializeOwned {
    /// The value as a settings page edits it, usually text.
    type Form: Clone + Debug + Default + Eq;

    /// The value as the form shows it before any edit.
    fn to_form(&self) -> Self::Form;

    /// Checks what was typed, refusing it with why it is not a valid value.
    fn from_form(form: &Self::Form) -> Result<Self, Invalid>;
}

/// Why typed text cannot become a preference.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum Invalid {
    #[error("not a whole number from 1 to {max}")]
    Count { max: u8 },
}

/// Values with nothing to check are their own form.
macro_rules! plain {
    ($($ty:ty),*) => {$(
        impl Preference for $ty {
            type Form = Self;

            fn to_form(&self) -> Self {
                self.clone()
            }

            fn from_form(form: &Self) -> Result<Self, Invalid> {
                Ok(form.clone())
            }
        }
    )*};
}

plain!(bool, u8, u16, u32, u64, i64, String);
