//! The Quiz route; `page.rs` says what it does.

mod components;
mod ids;
mod page;
#[cfg(test)]
mod tests;

pub(in crate::ui::screens::shell::page) use page::PracticeState;
