//! The microphone: recording into the database, a second at a time.

mod downsample;
mod recorder;

pub use recorder::{Ended, Recorder};
