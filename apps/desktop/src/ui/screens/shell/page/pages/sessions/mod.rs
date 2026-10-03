//! Study sessions, which the Projects route shows; `page.rs` says what they do.

mod components;
pub(in crate::ui::screens::shell::page) mod ids;
mod page;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(in crate::ui::screens::shell::page) use page::SidePanel;
pub(in crate::ui::screens::shell::page) use page::{SessionView, SessionsState};
