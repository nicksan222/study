//! The Library route; `page.rs` says what it does.

mod components;
mod ids;
mod page;
#[cfg(test)]
mod tests;

pub(in crate::ui::screens::shell::page) use components::MadeState;
pub(in crate::ui::screens::shell::page::pages) use components::{is_page, page_picture};
pub(in crate::ui::screens::shell::page) use page::MediaState;
