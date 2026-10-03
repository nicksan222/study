//! Enums picked from a fixed list, such as a provider or a theme, stored by a short code.

use std::fmt::Debug;
use std::hash::Hash;

/// An enum whose variants each have a stable text code. Declare one with [`crate::choice!`].
pub trait Choice: Copy + Debug + Eq + Ord + Hash + Send + Sync + 'static {
    /// Every variant, in declaration order.
    const ALL: &'static [Self];

    /// The stored code, for example `"openai"`.
    fn code(self) -> &'static str;

    /// The variant stored as `code`, or `None` for a code no variant has.
    fn from_code(code: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|choice| choice.code() == code)
    }
}

/// Declares an enum of choices: a [`text_enum!`](crate::text_enum!) with a default, that is
/// also its own settings form (the page shows one button per variant). The variant marked
/// `#[default]` is used until something else is picked.
///
/// ```
/// study_core::choice! {
///     /// How the window looks.
///     pub enum Appearance {
///         Light = "light",
///         #[default]
///         Dark = "dark",
///     }
/// }
///
/// assert_eq!(Appearance::from_code("light"), Some(Appearance::Light));
/// assert_eq!(Appearance::ALL, [Appearance::Light, Appearance::Dark]);
/// assert_eq!(Appearance::default(), Appearance::Dark);
/// ```
#[macro_export]
macro_rules! choice {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $(
                $(#[$variant_meta:meta])*
                $variant:ident = $code:literal
            ),+ $(,)?
        }
    ) => {
        $crate::text_enum! {
            $(#[$meta])*
            #[derive(Default)]
            $vis enum $name {
                $(
                    $(#[$variant_meta])*
                    $variant = $code,
                )+
            }
        }

        impl $crate::preferences::Choice for $name {
            const ALL: &'static [Self] = Self::ALL;

            fn code(self) -> &'static str {
                self.code()
            }
        }

        impl $crate::preferences::Preference for $name {
            type Form = Self;

            fn to_form(&self) -> Self {
                *self
            }

            fn from_form(form: &Self) -> ::std::result::Result<Self, $crate::preferences::Invalid> {
                Ok(*form)
            }
        }
    };
}
