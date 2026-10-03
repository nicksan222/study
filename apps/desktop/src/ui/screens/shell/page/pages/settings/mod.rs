//! The Settings route; `page.rs` says what it does.

mod components;
pub(super) mod ids;
mod page;

pub(in crate::ui::screens::shell::page) use components::{
    LlmState, ProcessingState, SystemState, TranscriptionState, UpdatesState,
};
