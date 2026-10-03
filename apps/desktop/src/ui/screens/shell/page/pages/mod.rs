//! The pages, one folder per route, and the pieces more than one draws (`components/`).
//! How a route's folder is laid out is in the shell's module docs.

mod components;
mod help;
mod home;
mod media_list;
mod onboarding;
mod pipelines;
mod practice;
mod projects;
mod sessions;
mod settings;
mod startup;
mod study;

pub(super) use components::{Alert, SourcePeek, kind_icon};
pub(super) use home::DashboardState;
pub(super) use media_list::{MadeState, MediaState};
pub(super) use onboarding::Onboarding;
pub(super) use pipelines::PipelinesState;
pub(super) use practice::PracticeState;
pub(super) use projects::ProjectsState;
pub(super) use sessions::SessionsState;
#[cfg(test)]
pub(super) use sessions::SidePanel;
pub(super) use settings::{
    LlmState, ProcessingState, SystemState, TranscriptionState, UpdatesState,
};
pub(super) use startup::Startup;
pub(super) use study::StudyState;
