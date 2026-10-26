//! One exhaustive catalog per locale.
//!
//! Each catalog matches every [`Message`] without a wildcard arm, so adding a
//! message fails to compile until every locale translates it.
//!
//! A new language gets a file here (copy `english.rs`, keep every arm and section comment in
//! place, translate the strings) and an arm in [`text`]. `tests/catalog_layout.rs` finds the
//! file on its own and checks there is one per `Locale::ALL` entry.

mod english;
mod italian;

use crate::{Locale, Message};

/// Look up copy using an exhaustive message catalog for each locale.
pub fn text(locale: Locale, message: Message) -> &'static str {
    match locale {
        Locale::English => english::text(message),
        Locale::Italian => italian::text(message),
    }
}
