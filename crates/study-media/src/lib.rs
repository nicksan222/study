//! Byte-level media for Study: turning stored bytes into what models read. No network, no
//! database access, no models.
//!
//! | Module      | What it holds                                                           |
//! |-------------|-------------------------------------------------------------------------|
//! | [`audio`]   | Any recording to 16 kHz mono (Symphonia, Opus, FFmpeg), and resampling  |
//! | [`pages`]   | Images and PDF pages as RGB bitmaps sized for a model, PNG encoding     |
//! | `error.rs`  | [`Error`], which knows its [`ErrorKind`](study_core::ErrorKind)       |

pub mod audio;
mod error;
pub mod pages;

pub use error::{Error, Result};
