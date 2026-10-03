//! Models that run on this machine: pinned downloads, the [`ModelInstall`] every local model
//! is installed through, and a pool of loaded copies.

mod download;
mod install;
mod pool;
mod spec;

pub use install::ModelInstall;
pub use pool::ModelPool;
pub use spec::{ModelFile, ModelSpec};
