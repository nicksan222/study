//! The welcome tour, shown in place of the pages; `page.rs` says what it does.

mod components;
mod ids;
mod page;

pub(in crate::ui::screens::shell::page) use page::Onboarding;
