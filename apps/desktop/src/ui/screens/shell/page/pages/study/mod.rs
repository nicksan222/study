//! The pages of study material (Notes, Flashcards, Diagrams); `page.rs` says
//! what they do.

mod components;
mod ids;
mod page;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(in crate::ui::screens::shell::page) use page::MaterialStatus;
pub(in crate::ui::screens::shell::page) use page::StudyState;
