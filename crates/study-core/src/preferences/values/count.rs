//! [`Count`]: a whole number from 1 to a maximum.

use std::fmt;
use std::num::NonZeroU8;

use serde::{Deserialize, Serialize};

use crate::preferences::{Invalid, Preference};

/// A whole number from 1 to `MAX`, such as how many model copies to load.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Count<const MAX: u8>(NonZeroU8);

impl<const MAX: u8> Count<MAX> {
    /// The smallest count.
    pub const ONE: Self = Self(NonZeroU8::MIN);

    /// `n` as a count, or `None` when it is 0 or above `MAX`.
    pub fn new(n: u8) -> Option<Self> {
        NonZeroU8::new(n).filter(|n| n.get() <= MAX).map(Self)
    }

    /// The number, from 1 to `MAX`.
    pub fn get(self) -> u8 {
        self.0.get()
    }

    /// The count as a size, the way the code that uses it usually wants it.
    pub fn as_usize(self) -> usize {
        usize::from(self.get())
    }

    /// Blank text is `Ok(None)`; otherwise a whole number from 1 to `MAX`.
    fn parse(text: &str) -> Result<Option<Self>, Invalid> {
        match text.trim() {
            "" => Ok(None),
            text => text
                .parse()
                .ok()
                .and_then(Self::new)
                .map(Some)
                .ok_or(Invalid::Count { max: MAX }),
        }
    }
}

impl<const MAX: u8> fmt::Display for Count<MAX> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl<const MAX: u8> TryFrom<u8> for Count<MAX> {
    type Error = Invalid;

    fn try_from(n: u8) -> Result<Self, Invalid> {
        Self::new(n).ok_or(Invalid::Count { max: MAX })
    }
}

impl<const MAX: u8> From<Count<MAX>> for u8 {
    fn from(count: Count<MAX>) -> Self {
        count.get()
    }
}

/// Blank text means one.
impl<const MAX: u8> Preference for Count<MAX> {
    type Form = String;

    fn to_form(&self) -> String {
        self.to_string()
    }

    fn from_form(form: &String) -> Result<Self, Invalid> {
        Ok(Self::parse(form)?.unwrap_or(Self::ONE))
    }
}

/// Blank text means "use the default".
impl<const MAX: u8> Preference for Option<Count<MAX>> {
    type Form = String;

    fn to_form(&self) -> String {
        self.map_or_else(String::new, |count| count.to_string())
    }

    fn from_form(form: &String) -> Result<Self, Invalid> {
        Count::parse(form)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_to_max_is_a_count() {
        assert_eq!(Count::<4>::new(0), None);
        assert_eq!(Count::<4>::new(4).map(Count::get), Some(4));
        assert_eq!(Count::<4>::new(5), None);
    }

    #[test]
    fn blank_text_is_one_or_the_default_and_anything_else_must_parse() {
        assert_eq!(Count::<4>::from_form(&" ".into()), Ok(Count::ONE));
        assert_eq!(Option::<Count<4>>::from_form(&" ".into()), Ok(None));
        assert_eq!(Count::<4>::from_form(&" 3 ".into()).map(Count::get), Ok(3));
        for bad in ["0", "5", "-1", "two", "1.5"] {
            assert_eq!(
                Count::<4>::from_form(&bad.into()),
                Err(Invalid::Count { max: 4 }),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn stored_values_out_of_range_are_refused() {
        assert_eq!(
            serde_json::from_str::<Count<4>>("2").map(Count::get).ok(),
            Some(2)
        );
        assert!(serde_json::from_str::<Count<4>>("0").is_err());
        assert!(serde_json::from_str::<Count<4>>("9").is_err());
        assert_eq!(
            serde_json::to_string(&Count::<4>::ONE).ok().as_deref(),
            Some("1")
        );
    }
}
