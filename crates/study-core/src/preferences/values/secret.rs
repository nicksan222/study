//! [`Secret`]: a credential that never shows in logs.

use std::fmt;

use serde::{Deserialize, Serialize};

/// A provider credential. It has no `Display`, and `Debug` never shows it.
#[derive(Clone, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// `None` for blank text: no key at all is different from an empty one.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        (!text.is_empty()).then(|| Self(text.to_owned()))
    }

    /// The secret itself; use it only to authenticate a request or to store it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}
